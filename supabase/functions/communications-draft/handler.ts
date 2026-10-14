/**
 * `communications-draft` (CM4): « Rédiger avec l'IA » in the composer. A user
 * function (CLAUDE.md §7).
 *
 * 1. CORS, `POST` only, the body (`readJson`), then `verifyAuth(req, {
 *    module: 'communications', permission: 'communications.ai_draft' })`
 *    and `communications.inbox` (drafting reads and writes mail).
 * 2. The caller's limit (`communications.ai_draft_user`, 40 an hour).
 * 3. `ai_draft_context_for_service(org, actor, client, thread)`: the rights
 *    again (and a thread she reads), the clinic's settings, the month's
 *    spending, and the names to keep from OpenAI (the file's person, the
 *    sender, the clinic, every correspondent of the thread). Off → a French
 *    refusal; the monthly cap reached → a French refusal (nothing is called).
 * 4. The key (`get_org_secret('openai_api_key')`); none → 503 `not_configured`.
 * 5. Everything sent is masked first (`mask.ts`): the file's person, the
 *    sender and the clinic become the composer's placeholders (gmail-send
 *    fills them at the send), the thread's other correspondents, addresses
 *    and numbers numbered tokens. The masked text of the message replied to
 *    is sent (CM-19).
 *    PS Hub's prompts (`prompts.ts`), then OpenAI's Chat Completions.
 * 6. Each call is recorded without its text (`record_ai_request_for_service`:
 *    the model, the kind, the result, the tokens, the cost).
 * 7. The answer: `{ text, subject, history }`, the tokens put back. A
 *    refusal of OpenAI's: 429 `rate_limited`, the credit exhausted or the key
 *    refused → a French refusal; anything else → 502 `provider_error`.
 *
 * Nothing logs or reports a text, a name or the key (ids and codes only).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  refusalResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { createMasker } from './mask.ts'
import {
  chatComplete,
  type ChatMessage,
  costCents,
  OPENAI_SECRET_KEY,
  OpenAiError,
  openAiOrigin,
} from './openai.ts'
import {
  buildSystemPrompt,
  buildUserTurn,
  type DraftMode,
  HISTORY_MAX,
  REPLY_INSTRUCTION,
  splitSubjectAndBody,
} from './prompts.ts'

const FN = 'communications-draft'
const INBOX_PERMISSION = 'communications.inbox'
const TEXT_MAX = 20_000

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(TEXT_MAX),
})

const bodySchema = z.object({
  mode: z.enum(['write', 'reply', 'refine']),
  instruction: z.string().max(2_000).default(''),
  draft: z.string().max(TEXT_MAX).default(''),
  original: z.string().max(TEXT_MAX).default(''),
  subject_empty: z.boolean().default(false),
  client_id: z.guid().nullable().optional(),
  thread_id: z.guid().nullable().optional(),
  history: z.array(turnSchema).max(HISTORY_MAX * 2).default([]),
})

const contextSchema = z.object({
  enabled: z.boolean(),
  model: z.string().min(1),
  monthly_cap_cents: z.number(),
  input_cents_per_mtok: z.coerce.number(),
  output_cents_per_mtok: z.coerce.number(),
  month_spent_cents: z.coerce.number(),
  person: z.object({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  }).nullable(),
  sender_name: z.string().nullable(),
  clinic_name: z.string().nullable(),
  correspondent_names: z.array(z.string()).max(50).default([]),
})

const money = (cents: number) =>
  `${(cents / 100).toLocaleString('fr-CA', { maximumFractionDigits: 2 })} $`

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const cors = handleCors(req)
    if (cors) return cors
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const body = await readJson(req, bodySchema)
    if (body instanceof Response) return body
    const auth = await verifyAuth(req, {
      module: 'communications',
      permission: 'communications.ai_draft',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    if (!auth.access.permissions.includes(INBOX_PERMISSION)) {
      return errorResponse(
        'forbidden',
        `Permission required: ${INBOX_PERMISSION}`,
        403,
        req,
      )
    }
    const orgId = auth.access.org_id
    const userId = auth.user.id
    const ids: Record<string, string> = { org_id: orgId, user_id: userId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const mode: DraftMode = body.mode
    const instruction = body.instruction.trim() ||
      (mode === 'reply' ? REPLY_INSTRUCTION : '')
    if (!instruction) {
      return refusalResponse('Écrivez ce que l’IA doit rédiger.', req)
    }

    const client = deps.serviceClient()
    if (client instanceof Response) return client
    const refused = limitResponse(
      await consume(client, LIMITS.aiDraftUser, [orgId, userId]),
      req,
    )
    if (refused) return refused

    const context = await client.rpc('ai_draft_context_for_service', {
      p_org_id: orgId,
      p_actor: userId,
      p_client_id: body.client_id ?? null,
      p_thread_id: body.thread_id ?? null,
    })
    if (context.error) {
      if (context.error.code === '42501') {
        return errorResponse('forbidden', 'Forbidden', 403, req)
      }
      await report('ai_context_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const ctx = contextSchema.safeParse(context.data)
    if (!ctx.success) {
      await report('ai_context_invalid')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const settings = ctx.data
    if (!settings.enabled) {
      return refusalResponse(
        'L’IA n’est pas activée : un administrateur l’active dans Paramètres → IA.',
        req,
      )
    }
    if (settings.month_spent_cents >= settings.monthly_cap_cents) {
      return refusalResponse(
        `Le plafond mensuel de l’IA est atteint (${
          money(settings.monthly_cap_cents)
        }) : il revient le 1er du mois, ou un administrateur le relève dans Paramètres → IA.`,
        req,
      )
    }

    const secret = await client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: OPENAI_SECRET_KEY,
    })
    if (secret.error) {
      await report('ai_secret_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (typeof secret.data !== 'string' || secret.data.trim() === '') {
      return errorResponse(
        'not_configured',
        'OpenAI is not configured',
        503,
        req,
      )
    }

    const masker = createMasker({
      firstName: settings.person?.first_name,
      lastName: settings.person?.last_name,
      senderName: settings.sender_name,
      clinicName: settings.clinic_name,
      others: settings.correspondent_names,
    })
    const userTurn = buildUserTurn({
      mode,
      instruction: masker.mask(instruction),
      draft: masker.mask(body.draft),
      original: masker.mask(body.original),
      subjectEmpty: body.subject_empty,
      personKnown: settings.person !== null,
    })
    const history = body.history.slice(-HISTORY_MAX * 2)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt({
          mode,
          subjectEmpty: body.subject_empty,
          personKnown: settings.person !== null,
        }),
      },
      ...history.map((turn) => ({
        role: turn.role,
        content: masker.mask(turn.content),
      })),
      { role: 'user', content: userTurn },
    ]
    const kind = mode
    const record = (
      status: 'ok' | 'failed',
      errorCode: string | null,
      prompt = 0,
      completion = 0,
      cost = 0,
    ) =>
      client.rpc('record_ai_request_for_service', {
        p_org_id: orgId,
        p_actor: userId,
        p_model: settings.model,
        p_kind: kind,
        p_status: status,
        p_error_code: errorCode,
        p_prompt_tokens: prompt,
        p_completion_tokens: completion,
        p_cost_cents: cost,
      })

    let result
    try {
      result = await chatComplete({
        fetch: deps.fetch,
        origin: openAiOrigin(deps.env),
        key: secret.data.trim(),
        model: settings.model,
        messages,
        signal: req.signal,
      })
    } catch (error) {
      const code = error instanceof OpenAiError ? error.code : 'provider_error'
      await record('failed', code)
      if (code === 'quota') {
        return refusalResponse(
          'Le crédit OpenAI de la clinique est épuisé : un administrateur le recharge dans le compte OpenAI.',
          req,
        )
      }
      if (code === 'auth') {
        await report('ai_key_refused')
        return refusalResponse(
          'OpenAI refuse la clé de la clinique : un administrateur la remplace dans Paramètres → IA.',
          req,
        )
      }
      if (code === 'rate_limited') {
        return errorResponse('rate_limited', 'OpenAI is busy', 429, req)
      }
      await report(`ai_${code}`)
      return errorResponse('provider_error', 'OpenAI did not answer', 502, req)
    }
    const cost = costCents(result, {
      input: settings.input_cents_per_mtok,
      output: settings.output_cents_per_mtok,
    })
    const recorded = await record(
      'ok',
      null,
      result.promptTokens,
      result.completionTokens,
      cost,
    )
    if (recorded.error) await report('ai_record_failed')

    const answer = masker.unmask(result.content)
    const split = mode === 'refine' || !body.subject_empty
      ? { subject: null, body: answer.trim() }
      : splitSubjectAndBody(answer)
    return jsonResponse(
      {
        text: split.body,
        subject: split.subject,
        history: [
          ...history,
          { role: 'user', content: masker.unmask(userTurn) },
          { role: 'assistant', content: answer },
        ].slice(-HISTORY_MAX * 2),
      },
      200,
      req,
    )
  }
}
