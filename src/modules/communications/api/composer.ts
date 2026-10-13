import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'

/*
 * The composer (CM3): each person's drafts (`save_mail_draft`, autosaved; never the browser's
 * storage), the templates (the clinic's from core's catalogue, and her own), « Écrire » from a
 * client record (`get_mail_compose_context`, `list_client_mail_threads`), and the send
 * (`gmail-send`: the server checks every id, fills the placeholders and builds the message).
 */

export const COMPOSE_MODES = ['new', 'reply', 'reply_all', 'forward'] as const
export type ComposeMode = (typeof COMPOSE_MODES)[number]

/** The composer's uploads (`upload_purposes.mail_outgoing`). */
export const OUTGOING_PURPOSE = 'mail_outgoing'
export const OUTGOING_MAX_BYTES = 10 * 1024 * 1024
export const OUTGOING_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const
/** What Gmail takes in one message, the attachments together (the database refuses beyond). */
export const MAX_ATTACHMENTS_BYTES = 18 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

/** The placeholders the server fills (CM-15), in the composer's « Insérer » menu. */
export const COMPOSE_PLACEHOLDERS = ['person.first_name', 'person.last_name', 'sender.name', 'clinic.name'] as const
export type ComposePlaceholder = (typeof COMPOSE_PLACEHOLDERS)[number]

const attachmentSchema = z.object({ id: z.string(), name: z.string(), mime_type: z.string(), size_bytes: z.number() })
export type DraftAttachment = z.infer<typeof attachmentSchema>

/** What the composer edits (and saves as a draft). */
export interface DraftContent {
  connectionId: string
  mode: ComposeMode
  threadId: string | null
  replyToMessageId: string | null
  clientId: string | null
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyHtml: string
  attachments: DraftAttachment[]
}

const draftSchema = z.object({
  id: z.string(),
  connection_id: z.string(),
  mode: z.enum(COMPOSE_MODES),
  thread_id: z.string().nullable(),
  reply_to_message_id: z.string().nullable(),
  client_id: z.string().nullable(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  subject: z.string(),
  body_html: z.string(),
  updated_at: z.string(),
  attachments: z.array(attachmentSchema),
})

export interface Draft extends DraftContent {
  id: string
  updatedAt: string
}

const toDraft = (row: z.infer<typeof draftSchema>): Draft => ({
  id: row.id,
  connectionId: row.connection_id,
  mode: row.mode,
  threadId: row.thread_id,
  replyToMessageId: row.reply_to_message_id,
  clientId: row.client_id,
  to: row.to,
  cc: row.cc,
  bcc: row.bcc,
  subject: row.subject,
  bodyHtml: row.body_html,
  attachments: row.attachments,
  updatedAt: row.updated_at,
})

const draftPayload = (content: DraftContent) => ({
  connection_id: content.connectionId,
  mode: content.mode,
  thread_id: content.threadId,
  reply_to_message_id: content.replyToMessageId,
  client_id: content.clientId,
  to: content.to,
  cc: content.cc,
  bcc: content.bcc,
  subject: content.subject,
  body_html: content.bodyHtml,
  file_ids: content.attachments.map((a) => a.id),
})

const savedSchema = z.object({ id: z.string(), updated_at: z.string() })

/** Saves the draft `id` (null: a new one); answers its id and time. */
export async function saveDraft(id: string | null, content: DraftContent): Promise<{ id: string; updatedAt: string }> {
  // The generated types want a uuid; null is « a new draft ».
  const { data, error } = await supabase.rpc('save_mail_draft', { p_id: id as string, p_draft: draftPayload(content) })
  if (error) throw error
  const saved = savedSchema.parse(data)
  return { id: saved.id, updatedAt: saved.updated_at }
}

/** One draft of the caller, or null when gone. */
export async function getDraft(id: string): Promise<Draft | null> {
  const { data, error } = await supabase.rpc('get_mail_draft', { p_id: id })
  if (error) throw error
  return data === null ? null : toDraft(draftSchema.parse(data))
}

const draftRowSchema = z.object({
  id: z.string(),
  connection_id: z.string(),
  mode: z.enum(COMPOSE_MODES),
  thread_id: z.string().nullable(),
  client_id: z.string().nullable(),
  subject: z.string(),
  to_addresses: z.array(z.string()),
  attachment_count: z.number(),
  updated_at: z.string(),
})
export type DraftRow = z.infer<typeof draftRowSchema>

/** The caller's drafts, newest first (50 at most). */
export async function listDrafts(): Promise<DraftRow[]> {
  const { data, error } = await supabase.rpc('list_mail_drafts')
  if (error) throw error
  return z.array(draftRowSchema).parse(data)
}

/** « Supprimer le brouillon ». */
export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_mail_draft', { p_id: id })
  if (error) throw error
}

const templateSchema = z.object({
  kind: z.enum(['clinic', 'personal']),
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  format: z.enum(['text', 'html']),
})
export type ComposeTemplate = z.infer<typeof templateSchema>

/** The clinic's templates, then the caller's own. */
export async function listTemplates(): Promise<ComposeTemplate[]> {
  const { data, error } = await supabase.rpc('list_mail_compose_templates')
  if (error) throw error
  return z.array(templateSchema).parse(data)
}

/** « Enregistrer comme modèle » (a new one) or renamed / rewritten (`id`). */
export async function saveTemplate(id: string | null, name: string, subject: string, bodyHtml: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_mail_template', {
    p_id: id as string,
    p_name: name,
    p_subject: subject,
    p_body_html: bodyHtml,
  })
  if (error) throw error
  return z.string().parse(data)
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_mail_template', { p_id: id })
  if (error) throw error
}

const contextSchema = z.object({
  client: z.object({ id: z.string(), client_number: z.number(), display_name: z.string() }),
  recipients: z.array(
    z.object({ email: z.string(), name: z.string(), is_self: z.boolean(), relation_type: z.string().nullable() }),
  ),
})
export type ComposeContext = z.infer<typeof contextSchema>

/** « Écrire un courriel » on a record: the file and the addresses that receive its communications. */
export async function getComposeContext(clientId: string): Promise<ComposeContext | null> {
  const { data, error } = await supabase.rpc('get_mail_compose_context', { p_client_id: clientId })
  if (error) throw error
  return data === null ? null : contextSchema.parse(data)
}

const clientThreadSchema = z.object({
  id: z.string(),
  connection_id: z.string(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  last_from_name: z.string().nullable(),
  last_from_address: z.string().nullable(),
  last_message_at: z.string().nullable(),
  message_count: z.number(),
  unread_count: z.number(),
  link_source: z.string().nullable(),
})
export type ClientThread = z.infer<typeof clientThreadSchema>

/** The threads linked to a file, newest first. */
export async function listClientThreads(clientId: string): Promise<ClientThread[]> {
  const { data, error } = await supabase.rpc('list_client_mail_threads', { p_client_id: clientId })
  if (error) throw error
  return z.array(clientThreadSchema).parse(data)
}

const sentSchema = z.object({ status: z.literal('sent'), thread_id: z.string().nullable(), gmail_message_id: z.string().nullable() })
export type SendResult = z.infer<typeof sentSchema>

/**
 * « Envoyer » (after the 5-second « Annuler l'envoi »): one key per click, kept for its retries, so
 * a request repeated never sends twice. The server checks and fills everything.
 */
export async function sendMail(sendKey: string, draftId: string | null, content: DraftContent, signal?: AbortSignal): Promise<SendResult> {
  return sentSchema.parse(
    await invokeFunction(
      'gmail-send',
      {
        send_key: sendKey,
        draft_id: draftId,
        ...draftPayload(content),
      },
      { signal },
    ),
  )
}
