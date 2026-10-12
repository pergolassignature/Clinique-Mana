/**
 * Client consents (Clients C5a): what `clients-consent-send` and the job
 * `clients-consent-reminders` share — the request prepared in the database
 * with two fresh link tokens (the actor model, ADR 0007: the tokens exist only
 * here and in the emails), then one email per signer with her own link — and
 * the clauses' answers as PDF blocks for `clients-consent-sign`.
 *
 * Nothing here logs or reports a name, an address, a token or an answer: the
 * reports carry the org, the request and the email log ids.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { jsonResponse } from './auth.ts'
import type { Deps } from './deps.ts'
import { rpcErrorResponse } from './errors.ts'
import { type SendResult, sendTemplatedEmail } from './email/send.ts'
import { generateToken, hashToken, linkUrl } from './links.ts'
import type { Block } from './pdf/model.ts'
import { reportError } from './report.ts'

const signerSchema = z.object({
  role: z.enum(['client', 'client_2']),
  signer_id: z.string(),
  first_name: z.string(),
  full_name: z.string(),
  email: z.string(),
  link_id: z.string(),
})

/** `prepare_client_consent_request_for_service`'s answer. */
export const preparedRequestSchema = z.object({
  request_id: z.string(),
  resent: z.boolean(),
  language: z.enum(['fr', 'en']),
  consent_name: z.string(),
  client_first_name: z.string(),
  clinic_name: z.string(),
  expires_at: z.string(),
  signers: z.array(signerSchema).min(1).max(2),
})
export type PreparedRequest = z.infer<typeof preparedRequestSchema>

/** What to prepare: a new request (client and consent) or an open one sent again. */
export interface PrepareInput {
  orgId: string
  /** The verified caller; null only for the reminder job (a re-send). */
  actor: string | null
  clientId?: string | null
  consentKey?: string | null
  contextType?: string | null
  contextId?: string | null
  dueAt?: string | null
  requestId?: string | null
}

/** The prepared request and each role's token (in memory only), or the RPC's error. */
export type PrepareResult =
  | { ok: true; prepared: PreparedRequest; tokens: Record<string, string> }
  | {
    ok: false
    error: { code?: string; message?: string; hint?: string } | null
  }

/**
 * Two tokens made and hashed here, the request prepared with their hashes:
 * the first goes to the `client` signer, the second to `client_2` (unused for
 * one signer).
 */
export async function prepareConsentRequest(
  client: SupabaseClient,
  input: PrepareInput,
): Promise<PrepareResult> {
  const tokens = [generateToken(), generateToken()]
  const [hash1, hash2] = await Promise.all(tokens.map(hashToken))
  const { data, error } = await client.rpc(
    'prepare_client_consent_request_for_service',
    {
      p_org_id: input.orgId,
      p_actor: input.actor,
      p_client_id: input.clientId ?? null,
      p_consent_key: input.consentKey ?? null,
      p_context_type: input.contextType ?? null,
      p_context_id: input.contextId ?? null,
      p_due_at: input.dueAt ?? null,
      p_token_hash_1: hash1,
      p_token_hash_2: hash2,
      p_request_id: input.requestId ?? null,
    },
  )
  if (error) return { ok: false, error }
  const parsed = preparedRequestSchema.safeParse(data)
  if (!parsed.success) return { ok: false, error: null }
  return {
    ok: true,
    prepared: parsed.data,
    tokens: { client: tokens[0], client_2: tokens[1] },
  }
}

/** The email template of a request's language. */
export const consentEmailTemplate = (language: 'fr' | 'en') =>
  language === 'en' ? 'clients.consent_request_en' : 'clients.consent_request'

/** One signer's outcome: sent, or the send's failure code. */
export interface SignerEmailOutcome {
  role: 'client' | 'client_2'
  ok: boolean
  code?: string
}

/**
 * Emails each signer her own link (`/consentement#t=…`). A failure for one
 * signer does not stop the other; each is reported with ids only.
 */
export async function emailConsentSigners(
  deps: Pick<Deps, 'env' | 'fetch'> & {
    fn: string
    client: SupabaseClient
  },
  orgId: string,
  prepared: PreparedRequest,
  tokens: Record<string, string>,
  sentBy: string | null,
): Promise<SignerEmailOutcome[]> {
  const appUrl = deps.env('APP_URL') ?? ''
  const outcomes: SignerEmailOutcome[] = []
  for (const signer of prepared.signers) {
    const ids = {
      org_id: orgId,
      client_consent_request_id: prepared.request_id,
    }
    let actionUrl: string
    try {
      actionUrl = linkUrl(appUrl, '/consentement', tokens[signer.role])
    } catch {
      await reportError(
        { fn: deps.fn, code: 'app_url_invalid', ids },
        deps.fetch,
      )
      outcomes.push({ role: signer.role, ok: false, code: 'not_configured' })
      continue
    }
    let result: SendResult
    try {
      result = await sendTemplatedEmail(
        { fn: deps.fn, client: deps.client, env: deps.env, fetch: deps.fetch },
        {
          orgId,
          templateKey: consentEmailTemplate(prepared.language),
          to: { email: signer.email, profileId: null },
          subject: { type: 'client_consent_request', id: prepared.request_id },
          values: {
            signer: { first_name: signer.first_name },
            client: { first_name: prepared.client_first_name },
            consent: { name: prepared.consent_name },
            clinic: { name: prepared.clinic_name },
            link: { expires_at: prepared.expires_at },
          },
          actionUrl,
          sentBy,
          // Each send is an explicit act on the request (its 5 s guard stops a double click).
          explicitResend: true,
        },
      )
    } catch {
      // sendTemplatedEmail reported it.
      outcomes.push({ role: signer.role, ok: false, code: 'internal' })
      continue
    }
    outcomes.push(
      result.ok
        ? { role: signer.role, ok: true }
        : { role: signer.role, ok: false, code: result.code },
    )
  }
  return outcomes
}

/** A clause as the request holds it. */
export interface Clause {
  key: string
  kind: 'agree' | 'yes_no'
  text_fr: string
  text_en: string
}

/**
 * The answers as the PDF prints them (R-46): one table, the clause and the
 * answer (« Oui » / « Non », « Accord requis » noted), in the request's
 * language. Built from the database's clauses and answers only.
 */
export function clauseBlocks(
  clauses: Clause[],
  answers: Record<string, unknown>,
  language: 'fr' | 'en',
): Block[] {
  const en = language === 'en'
  const yes = en ? 'Yes' : 'Oui'
  const no = en ? 'No' : 'Non'
  const required = en ? ' (agreement required)' : ' (accord requis)'
  return [{
    type: 'table',
    columns: [
      { label: en ? 'Clause' : 'Clause', width: 75 },
      { label: en ? 'Answer' : 'Réponse', width: 25 },
    ],
    rows: clauses.map((c) => [
      (en ? c.text_en : c.text_fr) + (c.kind === 'agree' ? required : ''),
      answers[c.key] === 'yes' ? yes : no,
    ]),
  }]
}

/** A HINT the UI may route on (`signer_required`, `template`, `answers`…). */
const FIELD_HINT = /^[a-z_]{1,40}$/

/**
 * An RPC error as the answer: a P0001 refusal is a 400 with its French
 * message and its HINT as `field`; anything else as `rpcErrorResponse`.
 */
export function consentRpcError(
  error: { code?: string; message?: string; hint?: string },
  req?: Request,
): Response {
  if (error.code !== 'P0001' || !error.message) {
    return rpcErrorResponse(error, req)
  }
  const field = error.hint && FIELD_HINT.test(error.hint) ? error.hint : null
  return jsonResponse(
    {
      error: {
        code: 'invalid_request',
        message: error.message,
        refusal: true,
        ...(field && { field }),
      },
    },
    400,
    req,
  )
}
