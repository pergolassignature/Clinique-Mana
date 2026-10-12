/**
 * `sms-send` (batch SM): a staff member texts a client from « Textos », or
 * an admin sends herself a test from Paramètres → Textos. A user function
 * (CLAUDE.md §7).
 *
 * 1. CORS, `POST` only, `verifyAuth(req, { module: 'communications',
 *    permission })`: `communications.sms` for a reply, `communications.sms_manage`
 *    for a test (`{ test: true }`).
 * 2. Body: `{ to, body }` (a reply: 1 to 1600 characters) or
 *    `{ test: true, to }` (the clinic's consent text is sent). `to` must read
 *    as a number (`normalizeE164`), else 400 `invalid_request` (refusal, in
 *    French): the database checks it again.
 * 3. Limits, per caller first (`sms.send_user` 60/h, or `sms.test_user` 5/h),
 *    then the clinic's day (`sms.org_day` 500).
 * 4. `queue_sms_for_service(org, actor, to, body, kind)` (service role, the
 *    actor model): re-checks the actor's permission, the consent (a reply to
 *    a number without one is a French P0001 → 400 `refusal`), records the
 *    text and claims it (`sending`).
 * 5. `sendClaimedText`: the transport (the PBX), then `mark_sms_sent` /
 *    `mark_sms_failed`. The answer: 200 `{ sms_message_id, status: 'sent' }`,
 *    or, for a failed send, 502 `provider_error` with
 *    `extra: { sms_message_id, code }` (the row shows « Échec » with the
 *    code; the UI's French text is per code), or 503 `not_configured` when
 *    the clinic's PBX settings are incomplete.
 *
 * Nothing logs or reports the number or the body (ids only).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  refusalResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Deps } from '../_shared/deps.ts'
import { isExpectedRpcError, rpcErrorResponse } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { normalizeE164 } from '../_shared/sms/phone.ts'
import { sendClaimedText } from '../_shared/sms/send.ts'
import {
  createYeastarTransport,
  type SmsTransport,
} from '../_shared/sms/transport.ts'

const FN = 'sms-send'

const bodySchema = z.union([
  z.object({
    test: z.literal(true),
    to: z.string().min(1).max(40),
  }),
  z.object({
    test: z.literal(false).optional(),
    to: z.string().min(1).max(40),
    body: z.string().min(1).max(1600),
  }),
])

const queuedSchema = z.object({
  id: z.guid(),
  to_e164: z.string(),
  body: z.string(),
  request_id: z.string(),
})

/** Codes the clinic must fix in Paramètres → Textos: answered 503 `not_configured`. */
const SETUP_CODES = new Set(['not_configured', 'module_disabled'])

export interface HandlerOptions {
  /** Injected by the tests; the Yeastar transport by default. */
  transport?: (client: SupabaseClient) => SmsTransport
}

/** The handler; see the module comment. */
export function createHandler(
  deps: Deps,
  options: HandlerOptions = {},
): (req: Request) => Promise<Response> {
  return async (req) => {
    const cors = handleCors(req)
    if (cors) return cors
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const body = await readJson(req, bodySchema)
    if (body instanceof Response) return body
    const isTest = body.test === true
    const auth = await verifyAuth(req, {
      module: 'communications',
      permission: isTest ? 'communications.sms_manage' : 'communications.sms',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const orgId = auth.access.org_id
    const userId = auth.user.id
    const ids: Record<string, string> = { org_id: orgId, user_id: userId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    if (normalizeE164(body.to) === null) {
      return refusalResponse(
        'Le numéro de téléphone n’est pas valide : indiquez un numéro à 10 chiffres.',
        req,
      )
    }

    const client = deps.serviceClient()
    if (client instanceof Response) return client
    const userLimit = await consume(
      client,
      isTest ? LIMITS.smsTestUser : LIMITS.smsSendUser,
      [orgId, userId],
    )
    const refused = limitResponse(userLimit, req)
    if (refused) return refused
    const orgLimit = await consume(client, LIMITS.smsOrgDay, [orgId])
    const orgRefused = limitResponse(orgLimit, req)
    if (orgRefused) return orgRefused

    let text: string
    if (isTest) {
      // The consent text, as the clinic wrote it (what a client receives first).
      const context = await client.rpc('get_sms_provider_context', {
        p_org_id: orgId,
      })
      const consentText = (context.data as { consent_text?: unknown } | null)
        ?.consent_text
      if (
        context.error || typeof consentText !== 'string' || consentText === ''
      ) {
        await report('sms_context_unavailable')
        return errorResponse('internal', 'Request failed', 500, req)
      }
      text = `Texto de test. ${consentText}`
    } else {
      text = (body as { body: string }).body
    }

    const queued = await client.rpc('queue_sms_for_service', {
      p_org_id: orgId,
      p_actor: userId,
      p_to: body.to,
      p_body: text,
      p_kind: isTest ? 'test' : 'reply',
    })
    if (queued.error) {
      if (!isExpectedRpcError(queued.error)) await report('queue_sms_failed')
      return rpcErrorResponse(queued.error, req)
    }
    const row = queuedSchema.safeParse(queued.data)
    if (!row.success) {
      await report('queue_sms_invalid')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    ids.sms_message_id = row.data.id

    const transport = options.transport
      ? options.transport(client)
      : createYeastarTransport({
        client,
        fetch: deps.fetch,
        now: deps.now,
        env: deps.env,
      })
    const outcome = await sendClaimedText(
      { fn: FN, client, transport, fetch: deps.fetch, signal: req.signal },
      orgId,
      row.data,
    )
    if (outcome.ok) {
      return jsonResponse(
        { sms_message_id: row.data.id, status: 'sent' },
        200,
        req,
      )
    }
    if (SETUP_CODES.has(outcome.code)) {
      return jsonResponse(
        {
          error: {
            code: 'not_configured',
            message: 'SMS is not configured',
            extra: { sms_message_id: row.data.id, code: outcome.code },
          },
        },
        503,
        req,
      )
    }
    return jsonResponse(
      {
        error: {
          code: 'provider_error',
          message: 'The PBX did not accept the text',
          extra: { sms_message_id: row.data.id, code: outcome.code },
        },
      },
      502,
      req,
    )
  }
}
