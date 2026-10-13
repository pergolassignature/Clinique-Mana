import { z } from 'zod'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'
import type { EmbeddedSigningLink } from '@/core/signing/components/EmbeddedSigning'

/**
 * The public consent page (`/consentement#t=…`, Clients C5a): `resolve-link` names the clinic and
 * the consent before anything personal; `clients-consent-sign` checks the identity (the client's
 * first name and birth year), shows the clauses, records the answers and starts the signature. The
 * token stays in component state; every call sends it in the body, never in a URL.
 */

const resolvedSchema = z.object({
  purpose: z.literal('client_consent'),
  display: z.object({
    clinic_name: z.string(),
    language: z.enum(['fr', 'en']),
    consent_name: z.string(),
    expires_at: z.string(),
  }),
})
export type ConsentLinkDisplay = z.infer<typeof resolvedSchema>['display']

/** What the link opens before the identity check; a link of another purpose reads as `link_invalid`. */
export async function resolveConsentLink(token: string): Promise<ConsentLinkDisplay> {
  const answer = resolvedSchema.safeParse(await invokeFunction('resolve-link', { token }))
  if (!answer.success) throw new FunctionCallError('link_invalid', 200, 'Not a consent link')
  return answer.data.display
}

const clauseSchema = z.object({
  key: z.string(),
  kind: z.enum(['agree', 'yes_no']),
  text_fr: z.string(),
  text_en: z.string(),
})
export type ConsentClause = z.infer<typeof clauseSchema>

const pageSchema = z.object({
  state: z.literal('ready'),
  request_id: z.string(),
  role: z.enum(['client', 'client_2']),
  language: z.enum(['fr', 'en']),
  clinic_name: z.string(),
  consent_name: z.string(),
  client_first_name: z.string(),
  signer_first_name: z.string(),
  clauses: z.array(clauseSchema),
  answers: z.record(z.string(), z.enum(['yes', 'no'])).nullable(),
  can_answer: z.boolean(),
  signing: z.string().nullable(),
})
export type ConsentPage = z.infer<typeof pageSchema>

export interface Identity {
  firstName: string
  /** Null when the person says the year is unknown (the file may have none). */
  birthYear: number | null
}

/** The page once the identity matches; throws a FunctionCallError (a refusal, `link_invalid`, `rate_limited`…). */
export async function openConsent(token: string, identity: Identity): Promise<ConsentPage> {
  const data = await invokeFunction('clients-consent-sign', {
    action: 'open',
    token,
    first_name: identity.firstName,
    birth_year: identity.birthYear,
  })
  const page = pageSchema.safeParse(data)
  if (!page.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return page.data
}

const linkSchema = z.object({ request_id: z.string(), token: z.string(), signing_url: z.string(), host: z.string() })

/** Records the answers (the first signer's) and returns the signer's embedded signing link. */
export async function startConsentSigning(
  token: string,
  identity: Identity,
  answers: Record<string, 'yes' | 'no'> | null,
  idempotencyKey: string,
): Promise<EmbeddedSigningLink> {
  const data = await invokeFunction('clients-consent-sign', {
    action: 'start',
    token,
    first_name: identity.firstName,
    birth_year: identity.birthYear,
    ...(answers && { answers }),
    idempotency_key: idempotencyKey,
  })
  const link = linkSchema.safeParse(data)
  if (!link.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return { host: link.data.host, token: link.data.token, signingUrl: link.data.signing_url }
}
