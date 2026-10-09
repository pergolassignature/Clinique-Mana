import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'
import { asRpcRefusal } from './function-errors'
import { parseRpc } from './parse'

/**
 * The professional signs her own image consent in the app (P4-487, P4-488; migration
 * *_professionals_image_consent.sql, function `professionals-consent-sign`): her step's state
 * (`get_my_image_consent`), « Signer le consentement » (her signing token, once) and the sync on
 * her return. The token and the signing URL are credentials: the caller keeps them in component
 * state only, never in React Query, a log or storage (CLAUDE.md §8).
 */

const requestPayload = z
  .object({
    status: z.string(),
    last_error: z.string().nullable(),
    sent_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    signed_at: z.string().nullable(),
  })
  .transform((r) => ({ status: r.status, lastError: r.last_error, sentAt: r.sent_at, completedAt: r.completed_at, signedAt: r.signed_at }))

export const myImageConsentPayload = z
  .object({
    available: z.boolean(),
    valid_until: z.string().nullable(),
    request: requestPayload.nullable(),
  })
  .transform((c) => ({
    /** The clinic published the form: it can be signed now. */
    available: c.available,
    /** The last day of her consent in force (a date-only value), or null. */
    validUntil: c.valid_until,
    /** Her latest consent request (no address, no link). */
    request: c.request,
  }))
  .nullable()
export type MyImageConsent = NonNullable<z.output<typeof myImageConsentPayload>>

/** Her consent step; null without a file. */
export async function fetchMyImageConsent(): Promise<MyImageConsent | null> {
  const { data, error } = await supabase.rpc('get_my_image_consent')
  if (error) throw error
  return parseRpc(myImageConsentPayload, data)
}

export const CONSENT_SIGN_FUNCTION = 'professionals-consent-sign'

const linkPayload = z.object({ request_id: z.string(), token: z.string().min(1), signing_url: z.url(), host: z.url() })

/** What the embed and its fallback need. A credential: component state only. */
export interface SigningLink {
  requestId: string
  token: string
  signingUrl: string
  host: string
}

/** Where Documenso sends her back after the full signing page (the fallback). */
export interface SigningReturn {
  returnTo: 'questionnaire' | 'documents'
  /** A questionnaire step slug (`consentement`). */
  returnStep?: string
}

/**
 * « Signer le consentement »: her open request resumed, else one made from the published form, sent
 * without an email. A refusal (P0001: the form not published, already signed, an inactive file)
 * comes back as an RPC refusal with its HINT; a 409 (a send under way) and Documenso's failures as
 * the `FunctionCallError`.
 */
export async function startConsentSigning(idempotencyKey: string, back: SigningReturn): Promise<SigningLink> {
  let data: unknown
  try {
    data = await invokeFunction(CONSENT_SIGN_FUNCTION, {
      action: 'start',
      idempotency_key: idempotencyKey,
      return_to: back.returnTo,
      ...(back.returnStep && { return_step: back.returnStep }),
    })
  } catch (error) {
    throw error instanceof FunctionCallError && error.code === 'conflict' ? error : asRpcRefusal(error)
  }
  const parsed = linkPayload.safeParse(data)
  if (!parsed.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return { requestId: parsed.data.request_id, token: parsed.data.token, signingUrl: parsed.data.signing_url, host: parsed.data.host }
}

const syncPayload = z.object({ outcome: z.string() })

/** After she signed (the embed's completion, or back from the signing page): Documenso read now. */
export async function syncMyConsent(): Promise<string> {
  const data = await invokeFunction(CONSENT_SIGN_FUNCTION, { action: 'sync' })
  const parsed = syncPayload.safeParse(data)
  if (!parsed.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return parsed.data.outcome
}
