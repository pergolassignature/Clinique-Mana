import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'

/*
 * « Courriels » (CM2): the thread list of a mailbox (`list_mail_threads`, keyset pages), one thread
 * (`get_mail_thread`), the mailbox's labels (the `mail_labels` table through its RLS), and the
 * actions (`gmail-modify`: Gmail first, then the mirror). Reads are SECURITY INVOKER: the caller's
 * RLS is the check.
 */

/** The list's views (the left pane). */
export const MAIL_VIEWS = ['inbox', 'unread', 'starred', 'sent', 'all'] as const
export type MailView = (typeof MAIL_VIEWS)[number] | 'label'

/** Threads per page (the RPC caps at 100). */
export const THREAD_PAGE_SIZE = 50

const threadRowSchema = z.object({
  id: z.string(),
  connection_id: z.string(),
  gmail_thread_id: z.string(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  last_from_name: z.string().nullable(),
  last_from_address: z.string().nullable(),
  last_message_at: z.string(),
  message_count: z.number(),
  unread_count: z.number(),
  has_attachments: z.boolean(),
  label_ids: z.array(z.string()),
  link_status: z.string(),
})
export type MailThreadRow = z.infer<typeof threadRowSchema>

export interface ThreadListQuery {
  connectionId: string
  view: MailView
  labelId?: string | null
  search?: string | null
}

/** Where the next page starts: the last row seen. */
export interface ThreadCursor {
  before: string
  beforeId: string
}

/** One page of threads, newest first. */
export async function listMailThreads(query: ThreadListQuery, cursor: ThreadCursor | null): Promise<MailThreadRow[]> {
  const { data, error } = await supabase.rpc('list_mail_threads', {
    p_connection_id: query.connectionId,
    p_view: query.view,
    ...(query.labelId && { p_label_id: query.labelId }),
    ...(query.search?.trim() && { p_search: query.search.trim() }),
    ...(cursor && { p_before: cursor.before, p_before_id: cursor.beforeId }),
    p_limit: THREAD_PAGE_SIZE,
  })
  if (error) throw error
  return z.array(threadRowSchema).parse(data)
}

const addressSchema = z.object({ name: z.string().nullable().optional(), address: z.string().nullable().optional() })

const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string().nullable(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
  content_id: z.string().nullable(),
  is_inline: z.boolean(),
  status: z.enum(['pending', 'stored', 'unsupported_type', 'too_large', 'failed', 'purged']),
  stored_file_id: z.string().nullable(),
})
export type MailAttachment = z.infer<typeof attachmentSchema>

const messageSchema = z.object({
  id: z.string(),
  gmail_message_id: z.string(),
  from_name: z.string().nullable(),
  from_address: z.string().nullable(),
  to: z.array(addressSchema),
  cc: z.array(addressSchema),
  reply_to_address: z.string().nullable(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  sent_at: z.string(),
  label_ids: z.array(z.string()),
  is_unread: z.boolean(),
  is_inbound: z.boolean(),
  body_html: z.string().nullable(),
  body_text: z.string().nullable(),
  body_purged: z.boolean(),
  attachments: z.array(attachmentSchema),
})
export type MailMessage = z.infer<typeof messageSchema>

const threadSchema = z.object({
  id: z.string(),
  connection_id: z.string(),
  mailbox: z.string(),
  gmail_thread_id: z.string(),
  subject: z.string().nullable(),
  label_ids: z.array(z.string()),
  message_count: z.number(),
  unread_count: z.number(),
  link_status: z.string(),
  messages: z.array(messageSchema),
})
export type MailThread = z.infer<typeof threadSchema>

/** One thread with its messages (oldest first), or null when gone or not readable. */
export async function getMailThread(threadId: string): Promise<MailThread | null> {
  const { data, error } = await supabase.rpc('get_mail_thread', { p_thread_id: threadId })
  if (error) throw error
  return data === null ? null : threadSchema.parse(data)
}

const labelSchema = z.object({
  gmail_label_id: z.string(),
  name: z.string(),
  type: z.enum(['system', 'user']),
  visibility: z.string().nullable(),
  color_background: z.string().nullable(),
})
export type MailLabel = z.infer<typeof labelSchema>

/** The mailbox's user labels shown in Gmail's list (hidden ones left out), by name. */
export async function listMailLabels(connectionId: string): Promise<MailLabel[]> {
  const { data, error } = await supabase
    .from('mail_labels')
    .select('gmail_label_id, name, type, visibility, color_background')
    .eq('connection_id', connectionId)
    .eq('type', 'user')
    .order('name')
  if (error) throw error
  return z.array(labelSchema).parse(data).filter((l) => l.visibility !== 'labelHide')
}

/** An action of the inbox (`_shared/gmail/actions.ts`). */
export type MailAction =
  | { kind: 'read' | 'unread' | 'archive' | 'inbox' | 'star' | 'unstar' }
  | { kind: 'label' | 'unlabel'; label_id: string }

const modifySchema = z.object({ changed: z.number(), failed: z.array(z.string()).default([]) })
export type ModifyResult = z.infer<typeof modifySchema>

/**
 * Applies `action` to threads (Gmail first, then the mirror, thread by thread): how many changed,
 * and the ids Gmail or the mirror refused (the request fails only when none changed).
 */
export async function modifyMailThreads(threadIds: string[], action: MailAction): Promise<ModifyResult> {
  return modifySchema.parse(await invokeFunction('gmail-modify', { thread_ids: threadIds, action }))
}
