import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/*
 * The thread → client link (CM2b, CM-12): the thread's link (`get_mail_thread_link`, invoker: the
 * mirror's RLS and Clients' own), « Rattacher » / « Détacher » (`link_mail_thread`,
 * `unlink_mail_thread`: definer, `communications.inbox` and `clients.view`), and the search of a
 * file through Clients' published `search_clients` (Communications does not depend on Clients: no
 * import of its code, only its published RPC, called when the person holds `clients.view`).
 */

const fileSchema = z.object({ id: z.string(), client_number: z.number(), display_name: z.string() })
export type LinkedFile = z.infer<typeof fileSchema>

const linkSchema = z.object({
  status: z.enum(['unlinked', 'needs_review', 'linked']),
  source: z.enum(['auto', 'manual']).nullable(),
  client: fileSchema.nullable(),
  candidates: z.array(fileSchema),
})
export type MailThreadLink = z.infer<typeof linkSchema>
/** A thread's link, mail or SMS (SM-15 reads the same shape from `get_sms_thread_link`). */
export const threadLinkSchema = linkSchema
export type ThreadLink = MailThreadLink

/** The thread's link, or null when the thread is gone or not readable. */
export async function getMailThreadLink(threadId: string): Promise<MailThreadLink | null> {
  const { data, error } = await supabase.rpc('get_mail_thread_link', { p_thread_id: threadId })
  if (error) throw error
  return data === null ? null : linkSchema.parse(data)
}

/** « Rattacher »: the thread goes to the file (a manual link: the sync never changes it). */
export async function linkMailThread(threadId: string, clientId: string): Promise<void> {
  const { error } = await supabase.rpc('link_mail_thread', { p_thread_id: threadId, p_client_id: clientId })
  if (error) throw error
}

/** « Détacher »: the thread has no file, and the sync never links it again. */
export async function unlinkMailThread(threadId: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_mail_thread', { p_thread_id: threadId })
  if (error) throw error
}

const searchRowSchema = z.object({
  id: z.string(),
  client_number: z.number(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  is_archived: z.boolean(),
})

/** One file found by the search (only what the picker shows: never the email or phone). */
export interface FileSearchResult {
  id: string
  clientNumber: number
  name: string
  isArchived: boolean
}

/** At least two characters before the search runs (as ⌘K). */
export const FILE_SEARCH_MIN_CHARS = 2

/** The files whose name, email, number or phone matches (Clients' `search_clients`, 8 at most). */
export async function searchFiles(query: string, signal?: AbortSignal): Promise<FileSearchResult[]> {
  let request = supabase.rpc('search_clients', { p_query: query.trim(), p_limit: 8 })
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  if (error) throw error
  return z
    .array(searchRowSchema)
    .parse(data)
    .map((row) => ({
      id: row.id,
      clientNumber: row.client_number,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      isArchived: row.is_archived,
    }))
}
