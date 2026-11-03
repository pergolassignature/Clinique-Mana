import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'
import type { EmbeddedSigningLink } from '@/core/signing/components/EmbeddedSigning'

/**
 * The professional's own side of the client consents (CC-22): what she still has to countersign,
 * and her embedded signing link. She reads her signer rows through `my_client_consent_signatures`
 * (definer, `clients.self`) and signs through `clients-consent-professional-sign`, which resumes
 * the envelope the client's signature put out — she never creates one.
 *
 * Every payload is parsed here; a mismatch throws UNEXPECTED_SHAPE (never Zod's issues, which
 * could quote a value). The signing token is a credential: it is returned once, kept in component
 * state and never cached (see `consentKeys`).
 */

export const UNEXPECTED_SHAPE = 'clients: unexpected consent signature shape'

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

/**
 * `waiting_client`: the client has not answered and signed yet, so there is nothing to sign;
 * `ready`: her box is waiting; `signed`: done, the request still open for someone else.
 */
export const SIGNATURE_STATES = ['waiting_client', 'ready', 'signed'] as const
export type ConsentSignatureState = (typeof SIGNATURE_STATES)[number]

const signatureSchema = z
  .object({
    request_id: z.string(),
    consent_key: z.string(),
    consent_name: z.string(),
    language: z.enum(['fr', 'en']),
    client_id: z.string(),
    client_name: z.string(),
    due_at: z.string().nullable(),
    requested_at: z.string().nullable(),
    state: z.enum(SIGNATURE_STATES),
  })
  .transform((r) => ({
    requestId: r.request_id,
    consentKey: r.consent_key,
    consentName: r.consent_name,
    language: r.language,
    clientId: r.client_id,
    clientName: r.client_name,
    dueAt: r.due_at,
    requestedAt: r.requested_at,
    state: r.state,
  }))
export type ConsentSignature = z.output<typeof signatureSchema>

/** The consents waiting for this professional, the soonest due first. */
export async function fetchMyConsentSignatures(): Promise<ConsentSignature[]> {
  const { data, error } = await supabase.rpc('my_client_consent_signatures')
  if (error) throw error
  return parse(z.array(signatureSchema), data)
}

const linkSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('waiting') }),
  z.object({
    state: z.literal('ready'),
    request_id: z.string(),
    token: z.string(),
    signing_url: z.string(),
    host: z.string(),
  }),
])

/** Her signing link, or `null` while the client has not signed yet. */
export async function startMyConsentSignature(requestId: string): Promise<EmbeddedSigningLink | null> {
  const data = await invokeFunction('clients-consent-professional-sign', { request_id: requestId })
  const answer = parse(linkSchema, data)
  if (answer.state === 'waiting') return null
  return { host: answer.host, token: answer.token, signingUrl: answer.signing_url }
}
