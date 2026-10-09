import { z } from 'zod'
import { signedFileUrl, uploadFile } from '@/core/storage/api'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'
import type { UploadStep } from '@/shared/lib/files'
import { CONSENT_KEYS, DOCUMENT_STATUSES, DOCUMENT_UPLOAD_PURPOSE, type ConsentKey } from '../lib/constants'
import { asRpcRefusal } from './function-errors'
import { parseRpc, UNEXPECTED_SHAPE } from './parse'
import { sqlArgs } from './sql-args'

/**
 * A professional's documents (Tasks 4c.2, 4c.3, 4c.6; 20261009000253_professionals_documents.sql):
 * the tab's and « Mes documents »' one read, the upload (storage pipeline, then attach), the
 * reviewer's actions, and « Paramètres → Consentements »
 * (20261009030156_professionals_documents_settings.sql). Every function throws the PostgREST error
 * unchanged; a function's refusal is thrown as the RPC error it passes on (`asRpcRefusal`).
 */

// --- The read (get_professional_documents) --------------------------------------------------------

const filePayload = z
  .object({ id: z.string(), name: z.string(), mime_type: z.string(), size_bytes: z.number() })
  .transform((f) => ({ id: f.id, name: f.name, mimeType: f.mime_type, sizeBytes: f.size_bytes }))

const documentPayload = z
  .object({
    id: z.string(),
    type_id: z.string(),
    type_key: z.string(),
    status: z.enum(DOCUMENT_STATUSES),
    expires_on: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).catch({}),
    uploaded_at: z.string(),
    uploaded_by_self: z.boolean(),
    reviewed_at: z.string().nullable(),
    reviewed_by_name: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    submission_id: z.string().nullable(),
    signature_request_id: z.string().nullable().default(null),
    file: filePayload.nullable(),
  })
  .transform((d) => ({
    id: d.id,
    typeId: d.type_id,
    typeKey: d.type_key,
    status: d.status,
    /** The last valid day (`yyyy-MM-dd`, a date-only value), for types with a rule. */
    expiresOn: d.expires_on,
    insurer: typeof d.metadata.insurer === 'string' ? d.metadata.insurer : null,
    policyNumber: typeof d.metadata.policy_number === 'string' ? d.metadata.policy_number : null,
    uploadedAt: d.uploaded_at,
    /** The professional sent it (« Mes documents » or the questionnaire); otherwise the clinic did. */
    uploadedBySelf: d.uploaded_by_self,
    reviewedAt: d.reviewed_at,
    /** Staff only (null for the provider, or once the reviewer's account is gone). */
    reviewedByName: d.reviewed_by_name,
    rejectionReason: d.rejection_reason,
    /** The questionnaire that brought it (P4-177). */
    submissionId: d.submission_id,
    /** The Documenso request it was signed through (an image consent, P4-485); null for an upload. */
    signatureRequestId: d.signature_request_id,
    /** Null once the file is gone (refused, P4-404; deleted). */
    file: d.file,
  }))
export type ProfessionalDocument = z.output<typeof documentPayload>
export type DocumentFile = NonNullable<ProfessionalDocument['file']>

const consentPayload = z
  .object({
    id: z.string(),
    version: z.number(),
    /** Staff only: null for the provider (P4-420, P4-472: a re-linked account would read the previous holder's). */
    signer_name: z.string().nullable(),
    signed_at: z.string(),
    expires_on: z.string(),
    withdrawn_at: z.string().nullable(),
    withdrawal_effective_on: z.string().nullable(),
  })
  .transform((c) => ({
    id: c.id,
    version: c.version,
    signerName: c.signer_name,
    signedAt: c.signed_at,
    /** Last valid day (date-only). */
    expiresOn: c.expires_on,
    withdrawnAt: c.withdrawn_at,
    /** The withdrawal takes effect on this day (3 months' notice, A3.5). */
    withdrawalEffectiveOn: c.withdrawal_effective_on,
  }))
export type ProfessionalConsent = z.output<typeof consentPayload>

export const documentsPayload = z
  .object({
    professional_id: z.string(),
    today: z.string(),
    photo: z.object({ document_id: z.string(), file_id: z.string() }).nullable(),
    documents: z.array(documentPayload),
    consent: consentPayload.nullable(),
  })
  .transform((p) => ({
    professionalId: p.professional_id,
    /** The clinic's date (`yyyy-MM-dd`): every card compares with it, never with the browser's. */
    today: p.today,
    /** The public profile's photo (the newest verified one). */
    photo: p.photo ? { documentId: p.photo.document_id, fileId: p.photo.file_id } : null,
    /** Newest first, at most 200. */
    documents: p.documents,
    /** The latest e-consent (« droit à l'image »), if any. */
    consent: p.consent,
  }))
  .nullable()
export type ProfessionalDocuments = NonNullable<z.output<typeof documentsPayload>>

/** The Documents tab (`professionals.view`): null for another clinic's or an unknown professional. */
export async function fetchProfessionalDocuments(id: string): Promise<ProfessionalDocuments | null> {
  const { data, error } = await supabase.rpc('get_professional_documents', { p_id: id })
  if (error) throw error
  return parseRpc(documentsPayload, data)
}

/** « Mes documents » (`professionals.self`): the signed-in professional's own record; null without one. */
export async function fetchMyDocuments(): Promise<ProfessionalDocuments | null> {
  const { data, error } = await supabase.rpc('get_professional_documents', {})
  if (error) throw error
  return parseRpc(documentsPayload, data)
}

// --- Upload and attach ----------------------------------------------------------------------------

export interface DocumentUploadInput {
  professionalId: string
  typeKey: string
  file: File
  /** The type to declare (the dropzone's `uploadMimeType`). */
  mimeType: string
  /** Last valid day (`yyyy-MM-dd`) for a type with a rule; null = the rule's default. */
  expiresOn: string | null
  /** Insurance only: the insurer and the policy number, when typed. */
  insurer?: string | null
  policyNumber?: string | null
  /**
   * The provider's own upload (`professional_self_document`), else staff's (`professional_document`).
   * Whoever holds `professionals.manage` uploads as staff, also on her own file (an admin who
   * practises): `attach_professional_document` checks `.manage` first (P4-464).
   */
  self: boolean
  onStep?: (step: UploadStep) => void
}

/**
 * Uploads the file through the storage pipeline (`storage-upload` → signed upload →
 * `storage-confirm`), subject the professional, then attaches it as a document of the type
 * (`attach_professional_document`: checks the type's files and size again, the date, the metadata;
 * verified at once for a reviewer on another's record, else pending). Resolves with the document id.
 */
export async function uploadProfessionalDocument(input: DocumentUploadInput): Promise<string> {
  const { fileId } = await uploadFile({
    purpose: input.self ? DOCUMENT_UPLOAD_PURPOSE.self : DOCUMENT_UPLOAD_PURPOSE.staff,
    subjectType: 'professional',
    subjectId: input.professionalId,
    file: input.file,
    mimeType: input.mimeType,
    onStep: input.onStep,
  })
  const metadata: Record<string, string> = {}
  if (input.insurer) metadata.insurer = input.insurer
  if (input.policyNumber) metadata.policy_number = input.policyNumber
  const { data, error } = await supabase.rpc(
    'attach_professional_document',
    sqlArgs<'attach_professional_document'>({
      p_id: input.professionalId,
      p_type_key: input.typeKey,
      p_file_id: fileId,
      p_expires_on: input.expiresOn,
      p_metadata: metadata,
    }),
  )
  if (error) throw error
  return parseRpc(z.string(), data)
}

/**
 * « Télécharger »: a fresh 5-minute URL that saves the file under its name (`storage-sign` with
 * `download`), asked at each press and never cached (P3-33). Readable by the caller's RLS, else 404.
 */
export async function documentDownloadUrl(fileId: string): Promise<string> {
  const { url } = await signedFileUrl(fileId, { download: true })
  return url
}

// --- The reviewer's actions -----------------------------------------------------------------------

/** « Vérifier »: pending → verified, with its last valid day for a type with a rule (null keeps the one given). */
export async function verifyProfessionalDocument(documentId: string, expiresOn: string | null): Promise<void> {
  const { error } = await supabase.rpc('verify_professional_document', sqlArgs<'verify_professional_document'>({ p_doc_id: documentId, p_expires_on: expiresOn }))
  if (error) throw error
}

/** « Modifier l'échéance » (audited). */
export async function setProfessionalDocumentExpiry(documentId: string, expiresOn: string): Promise<void> {
  const { error } = await supabase.rpc('set_professional_document_expiry', { p_doc_id: documentId, p_expires_on: expiresOn })
  if (error) throw error
}

/** « Supprimer » (`professionals.documents.delete`): the row goes (the audit keeps it), the file is purged 30 days later. */
export async function deleteProfessionalDocument(documentId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_professional_document', { p_doc_id: documentId })
  if (error) throw error
}

/** What « Refuser » did beyond the refusal: whether the professional was emailed, and if not why. */
export interface RejectResult {
  emailed: boolean
  /** Null when sent, or when no email was due (a file the clinic uploaded, P4-451). */
  emailProblem: { code: string; retryAfter: number | null } | null
}

const rejectAnswer = z.object({
  ok: z.literal(true),
  emailed: z.boolean(),
  email_problem: z.string().nullable(),
  retry_after: z.number().optional(),
})

/**
 * « Refuser » through `professionals-documents` (P4-451): the refusal as the caller (the reason is
 * kept for the professional, the file is removed, P4-404), then the email « Un document est à
 * reprendre » for a file she sent. A refusal of the RPC is thrown as `{ code: 'P0001', message, hint }`.
 */
export async function rejectProfessionalDocument(documentId: string, reason: string): Promise<RejectResult> {
  try {
    const answer = rejectAnswer.safeParse(await invokeFunction('professionals-documents', { action: 'reject', document_id: documentId, reason }))
    if (!answer.success) throw new Error(UNEXPECTED_SHAPE)
    const { emailed, email_problem, retry_after } = answer.data
    return { emailed, emailProblem: email_problem === null ? null : { code: email_problem, retryAfter: retry_after ?? null } }
  } catch (error) {
    if (error instanceof FunctionCallError) throw asRpcRefusal(error)
    throw error
  }
}

// --- « Paramètres → Consentements » ---------------------------------------------------------------

const consentVersionPayload = z
  .object({
    id: z.string(),
    version: z.number(),
    title: z.string(),
    body: z.string(),
    published_at: z.string().nullable(),
    published_by_name: z.string().nullable(),
    signed_count: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((v) => ({
    id: v.id,
    version: v.version,
    title: v.title,
    body: v.body,
    /** Null while a draft. */
    publishedAt: v.published_at,
    publishedByName: v.published_by_name,
    /** How many signatures this version holds. */
    signedCount: v.signed_count,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  }))
export type ConsentVersion = z.output<typeof consentVersionPayload>

const consentVersionsPayload = z
  .object({ key: z.enum(CONSENT_KEYS), current_id: z.string().nullable(), versions: z.array(consentVersionPayload) })
  .transform((p) => {
    const current = p.versions.find((v) => v.id === p.current_id) ?? null
    return {
      key: p.key,
      /** The version every new signature uses (the latest published). */
      current,
      /** The clinic's draft, if one is being written (one at most). */
      draft: p.versions.find((v) => v.publishedAt === null) ?? null,
      /** Published versions other than the current one, newest first. */
      previous: p.versions.filter((v) => v.publishedAt !== null && v.id !== current?.id),
    }
  })
export type ConsentVersions = z.output<typeof consentVersionsPayload>

/** The versions of a consent (`professionals.manage` or `professionals.settings`). */
export async function fetchConsentVersions(key: ConsentKey = 'image_rights'): Promise<ConsentVersions> {
  const { data, error } = await supabase.rpc('get_consent_versions', { p_key: key })
  if (error) throw error
  return parseRpc(consentVersionsPayload, data)
}

/** « Enregistrer le brouillon » (`professionals.settings`): creates the next version or rewrites the draft; its id. */
export async function saveConsentDraft(input: { key?: ConsentKey; title: string; body: string }): Promise<string> {
  const { data, error } = await supabase.rpc('save_consent_draft', { p_key: input.key ?? 'image_rights', p_title: input.title, p_body: input.body })
  if (error) throw error
  return parseRpc(z.string(), data)
}

/** « Publier »: the draft becomes the version signing uses; signatures already given keep theirs. */
export async function publishConsentVersion(id: string): Promise<void> {
  const { error } = await supabase.rpc('publish_consent_version', { p_id: id })
  if (error) throw error
}

/** « Supprimer le brouillon »: a draft only (never signed). */
export async function discardConsentDraft(id: string): Promise<void> {
  const { error } = await supabase.rpc('discard_consent_draft', { p_id: id })
  if (error) throw error
}
