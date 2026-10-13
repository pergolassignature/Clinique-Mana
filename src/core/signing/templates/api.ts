import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/**
 * Document templates and their versions, for the shared editor (CC-12): a module's templates
 * (`list_document_templates(module)`, RLS: each one's view permission) and the core version RPCs
 * (the template's edit permission). Professionnels' « Contrats et formulaires » and Clients'
 * consents use them. Every function throws the PostgREST error unchanged; a payload that does not
 * parse throws UNEXPECTED_SHAPE (never Zod's issues).
 */

export const UNEXPECTED_SHAPE = 'signing: unexpected template shape'

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

// --- Templates and versions ---------------------------------------------------------------------

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
    /** The caller holds the template's edit permission. */
    canEdit: t.can_edit,
    publishedVersion: t.published_version,
    publishedAt: t.published_at,
    draftVersionId: t.draft_version_id,
  }))
export type DocumentTemplateSummary = z.output<typeof templatePayload>

/** A module's templates (`list_document_templates(module)`, RLS: each one's view permission). */
export async function listModuleTemplates(moduleKey: string): Promise<DocumentTemplateSummary[]> {
  const { data, error } = await supabase.rpc('list_document_templates', { p_module_key: moduleKey })
  if (error) throw error
  return parse(z.array(templatePayload), data)
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
  role: z.enum(['professional', 'clinic', 'client', 'client_2']),
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
    /** A `PdfDocument` (the renderer's model); `markup.ts` reads and writes it. */
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

/** A template's versions, newest first (core's `list_document_template_versions`: the template's view permission). */
export async function fetchTemplateVersions(templateId: string): Promise<TemplateVersion[]> {
  const { data, error } = await supabase.rpc('list_document_template_versions', { p_template_id: templateId })
  if (error) throw error
  return parse(z.array(versionPayload), data)
}

/** « Nouvelle version »: a draft copied from the published version (the template's edit permission). */
export async function createTemplateVersion(templateId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_template_version', { p_template_id: templateId })
  if (error) throw error
  return parse(z.string(), data)
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

/** « Publier »: the previous published version is archived; the next sends use this one. */
export async function publishTemplateVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_template_version', { p_id: versionId })
  if (error) throw error
}

/** « Supprimer le brouillon » (a draft is archived, never deleted) or « Retirer » a published version. */
export async function archiveTemplateVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_template_version', { p_id: versionId })
  if (error) throw error
}
