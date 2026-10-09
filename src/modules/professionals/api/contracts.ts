import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'
import { asRpcRefusal } from './function-errors'
import { parseRpc } from './parse'

/**
 * The service contract (Batch 4d; migration *_professionals_contracts.sql, function
 * `professionals-contract-send`): the record's card (`get_professional_contract`,
 * `professionals.view`), the send actions (`professionals.contracts.send` and
 * `professionals.compensation`), and « Paramètres → Contrats »: the module's document templates
 * and their versions (core signing RPCs, the template's edit permission). Every function throws
 * the PostgREST error unchanged, or the function's error as an RPC refusal (`asRpcRefusal`).
 */

// --- The card (get_professional_contract) --------------------------------------------------------

const signerPayload = z
  .object({
    role: z.string(),
    name: z.string(),
    status: z.string(),
    signing_order: z.number(),
    viewed_at: z.string().nullable(),
    signed_at: z.string().nullable(),
    rejected_at: z.string().nullable(),
  })
  .transform((s) => ({
    role: s.role,
    name: s.name,
    status: s.status,
    order: s.signing_order,
    viewedAt: s.viewed_at,
    signedAt: s.signed_at,
    rejectedAt: s.rejected_at,
  }))
export type ContractSigner = z.output<typeof signerPayload>

const requestPayload = z
  .object({
    id: z.string(),
    status: z.string(),
    last_error: z.string().nullable(),
    template_version: z.number().nullable(),
    created_at: z.string(),
    send_started_at: z.string().nullable(),
    last_send_at: z.string().nullable(),
    sent_at: z.string().nullable(),
    viewed_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    rejected_at: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    expired_at: z.string().nullable(),
    expires_at: z.string().nullable(),
    can_read: z.boolean(),
    signed_file_id: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    signers: z.array(signerPayload),
  })
  .transform((r) => ({
    id: r.id,
    status: r.status,
    lastError: r.last_error,
    templateVersion: r.template_version,
    createdAt: r.created_at,
    /** The send claim (core `begin_signature_request_send`): set while a send runs. */
    sendStartedAt: r.send_started_at,
    lastSendAt: r.last_send_at,
    sentAt: r.sent_at,
    viewedAt: r.viewed_at,
    completedAt: r.completed_at,
    rejectedAt: r.rejected_at,
    cancelledAt: r.cancelled_at,
    expiredAt: r.expired_at,
    expiresAt: r.expires_at,
    /** The caller holds the request's view permission (`professionals.compensation`, P4-435). */
    canRead: r.can_read,
    /** Only when `canRead`. */
    signedFileId: r.signed_file_id,
    /** The signer's reason, only when `canRead`. */
    rejectionReason: r.rejection_reason,
    signers: r.signers,
  }))
export type ContractRequest = z.output<typeof requestPayload>

export const contractPayload = z
  .object({
    template: z
      .object({
        id: z.string(),
        published_version_id: z.string().nullable(),
        published_version: z.number().nullable(),
        published_at: z.string().nullable(),
        draft_version_id: z.string().nullable(),
      })
      .nullable(),
    clinic_signer: z.boolean(),
    request: requestPayload.nullable(),
  })
  .transform((c) => ({
    /** The published version that a send would use; null when nothing is published (or no template). */
    publishedVersion: c.template?.published_version ?? null,
    /** Settings « Signataire » has a name and an address: the clinic signs second. */
    clinicSigner: c.clinic_signer,
    /** The latest service-contract request, or null. */
    request: c.request,
  }))
export type ProfessionalContract = z.output<typeof contractPayload>

/** The record's contract card; null for a file the caller cannot read. */
export async function fetchProfessionalContract(id: string): Promise<ProfessionalContract | null> {
  const { data, error } = await supabase.rpc('get_professional_contract', { p_id: id })
  if (error) throw error
  return data === null ? null : parseRpc(contractPayload, data)
}

// --- Sending (professionals-contract-send) -------------------------------------------------------

export const CONTRACT_FUNCTION = 'professionals-contract-send'
export type ContractAction = 'send' | 'regenerate' | 'resend'

const sentPayload = z.object({ request_id: z.string() })

/**
 * « Préparer et envoyer » / « Réessayer l'envoi » (`send`), « Régénérer », « Renvoyer ». One
 * idempotency key per user action: the same key returns the same request. A refusal (P0001: no
 * published template, prices to configure, a contract already out…) comes back as an RPC refusal
 * with its HINT; a missing template value as the `FunctionCallError` (`missing_variable`, its
 * French `label` in `extra`). A 409 stays the `FunctionCallError`: here it means « un envoi est
 * déjà en cours » (the send claim), not the record's « le dossier vient de changer » (40001).
 */
export async function sendProfessionalContract(professionalId: string, action: ContractAction, idempotencyKey: string): Promise<string> {
  let data: unknown
  try {
    data = await invokeFunction(CONTRACT_FUNCTION, { professional_id: professionalId, action, idempotency_key: idempotencyKey })
  } catch (error) {
    throw error instanceof FunctionCallError && error.code === 'conflict' ? error : asRpcRefusal(error)
  }
  const parsed = sentPayload.safeParse(data)
  if (!parsed.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return parsed.data.request_id
}

// --- « Paramètres → Contrats »: templates and versions ---------------------------------------------

export const templatePayload = z
  .object({
    id: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    is_active: z.boolean(),
    can_edit: z.boolean(),
    published_version_id: z.string().nullable(),
    published_version: z.number().nullable(),
    published_at: z.string().nullable(),
    draft_version_id: z.string().nullable(),
  })
  .transform((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    description: t.description,
    isActive: t.is_active,
    /** The caller holds the template's edit permission (`professionals.settings`). */
    canEdit: t.can_edit,
    publishedVersion: t.published_version,
    publishedAt: t.published_at,
    draftVersionId: t.draft_version_id,
  }))
export type ContractTemplate = z.output<typeof templatePayload>

/** The module's templates (`list_document_templates('professionals')`, RLS: each one's view permission). */
export async function listContractTemplates(): Promise<ContractTemplate[]> {
  const { data, error } = await supabase.rpc('list_document_templates', { p_module_key: 'professionals' })
  if (error) throw error
  return parseRpc(z.array(templatePayload), data)
}

const variablePayload = z.object({
  path: z.string(),
  label: z.string(),
  sample: z.string(),
  required: z.boolean(),
  kind: z.enum(['text', 'date', 'datetime', 'url']),
})
export type TemplateVariable = z.output<typeof variablePayload>

const versionSignerPayload = z.object({
  role: z.enum(['professional', 'clinic', 'client']),
  label: z.string(),
  order: z.number(),
  required: z.boolean(),
})
export type VersionSigner = z.output<typeof versionSignerPayload>

export const versionPayload = z
  .object({
    id: z.string(),
    version: z.number(),
    status: z.enum(['draft', 'published', 'archived']),
    body: z.record(z.string(), z.unknown()),
    variables: z.array(variablePayload),
    signers: z.array(versionSignerPayload),
    email_subject: z.string(),
    email_message: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    published_at: z.string().nullable(),
    archived_at: z.string().nullable(),
  })
  .transform((v) => ({
    id: v.id,
    version: v.version,
    status: v.status,
    /** A `PdfDocument` (the renderer's model); `lib/contract-markup.ts` reads and writes it. */
    body: v.body,
    variables: v.variables,
    signers: v.signers,
    emailSubject: v.email_subject,
    emailMessage: v.email_message,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
    publishedAt: v.published_at,
    archivedAt: v.archived_at,
  }))
export type TemplateVersion = z.output<typeof versionPayload>

/** A template's versions, newest first (RLS: the template's view permission). */
export async function fetchTemplateVersions(templateId: string): Promise<TemplateVersion[]> {
  const { data, error } = await supabase
    .from('document_template_versions')
    .select('id, version, status, body, variables, signers, email_subject, email_message, created_at, updated_at, published_at, archived_at')
    .eq('template_id', templateId)
    .order('version', { ascending: false })
  if (error) throw error
  return parseRpc(z.array(versionPayload), data)
}

/** « Nouvelle version »: a draft copied from the published version (the template's edit permission). */
export async function createTemplateVersion(templateId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_template_version', { p_template_id: templateId })
  if (error) throw error
  return parseRpc(z.string(), data)
}

export interface DraftContent {
  body: Record<string, unknown>
  variables: TemplateVariable[]
  signers: VersionSigner[]
  emailSubject: string
  emailMessage: string
}

/**
 * « Enregistrer le brouillon ». The database refuses (P0001, French) an undeclared placeholder, a
 * subject over 200 characters or on two lines, a message over 5 000 characters, a body over 256 KB.
 */
export async function updateTemplateVersion(versionId: string, content: DraftContent): Promise<void> {
  const { error } = await supabase.rpc('update_template_version', {
    p_id: versionId,
    p_body: content.body as never,
    p_variables: content.variables as never,
    p_signers: content.signers as never,
    p_email_subject: content.emailSubject,
    p_email_message: content.emailMessage,
  })
  if (error) throw error
}

/** « Publier »: the previous published version is archived; the next contracts use this one. */
export async function publishTemplateVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_template_version', { p_id: versionId })
  if (error) throw error
}

/** « Supprimer le brouillon » (a draft is archived, never deleted) or « Retirer » a published version. */
export async function archiveTemplateVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_template_version', { p_id: versionId })
  if (error) throw error
}
