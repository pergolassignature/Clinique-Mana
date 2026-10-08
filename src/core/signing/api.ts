import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'

/** The signing settings of the caller's org (`signing_settings`; the keys are org secrets). */
export interface SigningSettings {
  /** The clinic's Documenso instance; null until it is set. */
  base_url: string | null
  /** Days before an invitation expires (1–60). */
  expiry_days: number
}

/**
 * A document template as « Modèles de documents » lists it (`list_document_templates`, RLS: the
 * template's view permission). A template without a published version cannot be sent.
 */
const templateSchema = z.object({
  id: z.string(),
  key: z.string(),
  module_key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  published_version: z.number().nullable(),
  published_at: z.string().nullable(),
  draft_version_id: z.string().nullable(),
})
export type DocumentTemplate = z.infer<typeof templateSchema>

/**
 * A signature request's state (`list_subject_signature_requests`, RLS: the request's view
 * permission): what `signatureStatusLabel` reads, and when it was created and sent.
 */
const requestSchema = z.object({
  id: z.string(),
  status: z.string(),
  last_error: z.string().nullable(),
  created_at: z.string(),
  sent_at: z.string().nullable(),
})
export type SignatureRequestRow = z.infer<typeof requestSchema>

/**
 * A request the signing reconcile has not read successfully for over 6 hours
 * (`list_unverified_signature_requests`, `settings.integrations_manage`): its title only when the
 * caller may see the request (null otherwise), its last successful read and since when it fails
 * (null: never), and the failure's code (null: the runs have not reached it).
 */
const unverifiedSchema = z.object({
  id: z.string(),
  module_key: z.string(),
  title: z.string().nullable(),
  sent_at: z.string().nullable(),
  synced_at: z.string().nullable(),
  failing_since: z.string().nullable(),
  error_code: z.string().nullable(),
})
export type UnverifiedSignatureRequest = z.infer<typeof unverifiedSchema>

/** `signing-test-connection`: Documenso answered, or its HTTP status when it refused. */
const connectionSchema = z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), status: z.number() })])
export type ConnectionResult = z.infer<typeof connectionSchema>

const testDocumentSchema = z.object({ request_id: z.string(), existing: z.boolean() })
const syncSchema = z.object({ request_id: z.string(), outcome: z.string() })
type SyncResult = z.infer<typeof syncSchema>

/** Calls a signing function and checks its answer; an unexpected answer is an `internal` refusal. */
async function invokeSigning<T>(name: string, body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const answer = schema.safeParse(await invokeFunction(name, body))
  if (!answer.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return answer.data
}

/** The signing settings of the caller's org (RLS returns only their own; `settings.view`). */
export async function fetchSigningSettings(): Promise<SigningSettings> {
  const { data, error } = await supabase.from('signing_settings').select('base_url, expiry_days').single()
  if (error) throw error
  return data
}

/** The fields one save changes; a field left out keeps its stored value (P3-34). */
export type SigningSettingsPatch = Partial<SigningSettings>

const setResultSchema = z.object({ api_key_cleared: z.boolean() })
/** What a save did besides storing the fields. */
export type SetSigningSettingsResult = z.infer<typeof setResultSchema>

/**
 * Saves only the fields given (`set_signing_settings` takes a patch: each card sends its own, so
 * one card never writes back a stale copy of the other's). `settings.integrations_manage`; a
 * value the checks refuse → 23514. A new address origin deletes the stored API key in the same
 * transaction (`api_key_cleared`, P3-34).
 */
export async function setSigningSettings(patch: SigningSettingsPatch): Promise<SetSigningSettingsResult> {
  const { data, error } = await supabase.rpc('set_signing_settings', { p: patch })
  if (error) throw error
  return setResultSchema.parse(data)
}

/** When the caller's org last received a Documenso event; null when never (`settings.view`). */
export async function lastDocumensoEventAt(): Promise<string | null> {
  const { data, error } = await supabase.rpc('last_webhook_event_at', { p_provider: 'documenso' })
  if (error) throw error
  // The generated type says string; max() over no row is null.
  return (data as string | null) ?? null
}

/**
 * The caller's latest test document (`signing-test-document` files it under `signing_test` / the
 * caller's id), or null. Readable with `settings.integrations_manage` only (its view permission).
 */
export async function lastSigningTest(userId: string): Promise<SignatureRequestRow | null> {
  const { data, error } = await supabase.rpc('list_subject_signature_requests', {
    p_subject_type: 'signing_test',
    p_subject_id: userId,
    p_limit: 1,
  })
  if (error) throw error
  return z.array(requestSchema).parse(data)[0] ?? null
}

/** The document templates the caller may see, every module's (`settings.view` and each template's view permission). */
export async function listDocumentTemplates(): Promise<DocumentTemplate[]> {
  const { data, error } = await supabase.rpc('list_document_templates')
  if (error) throw error
  return z.array(templateSchema).parse(data)
}

/** The caller's org's requests no read reaches, oldest successful read first (`settings.integrations_manage`). */
export async function listUnverifiedSignatureRequests(): Promise<UnverifiedSignatureRequest[]> {
  const { data, error } = await supabase.rpc('list_unverified_signature_requests')
  if (error) throw error
  return z.array(unverifiedSchema).parse(data)
}

/** « Tester la connexion » (`settings.integrations_manage`): one authenticated read at the stored instance. */
export async function testSigningConnection(): Promise<ConnectionResult> {
  return invokeSigning('signing-test-connection', {}, connectionSchema)
}

/**
 * « Envoyer un document test » (`settings.integrations_manage`): the built-in one-page document,
 * to the caller (the function never takes an address). The same key returns the same request, and
 * sends a failed one again.
 */
export async function sendSigningTestDocument(idempotencyKey: string): Promise<z.infer<typeof testDocumentSchema>> {
  return invokeSigning('signing-test-document', { idempotency_key: idempotencyKey }, testDocumentSchema)
}

/** « Actualiser l'état »: reads a request back from Documenso and applies what changed (`signing-sync`). */
export async function syncSignatureRequest(requestId: string): Promise<SyncResult> {
  return invokeSigning('signing-sync', { request_id: requestId }, syncSchema)
}

/** The address Documenso posts events to; `org` only routes the event (the function checks the secret). */
export function webhookUrl(orgId: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signing-webhook?org=${encodeURIComponent(orgId)}`
}
