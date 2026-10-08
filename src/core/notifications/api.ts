import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/** Notices per page of the bell's list (the RPC clamps the limit to 1–50; a page asks for one more). */
export const NOTIFICATIONS_PAGE_SIZE = 20

/** At most this many notices in Accueil « À surveiller ». */
export const IMPORTANT_NOTICES_LIMIT = 5

/**
 * One notice of the caller, as `list_my_notifications` returns it. The generated types say
 * non-null everywhere, but `body`, `link_path` and the subject are optional. `title` and `body`
 * are French, written by the module that created the notice, ready to display.
 */
const noticeSchema = z.object({
  id: z.string(),
  module_key: z.string(),
  kind: z.string(),
  importance: z.enum(['normal', 'important']),
  title: z.string(),
  body: z.string().nullable(),
  /** App-relative (checked by the database); still guarded before navigating (noticeLinkPath). */
  link_path: z.string().nullable(),
  subject_type: z.string().nullable(),
  subject_id: z.string().nullable(),
  created_at: z.string(),
  is_read: z.boolean(),
})
export type Notice = z.infer<typeof noticeSchema>

const unreadCountSchema = z.object({ total: z.number(), important: z.number() })
export type UnreadCount = z.infer<typeof unreadCountSchema>

/**
 * Where the next page starts: the last row seen. Both fields, always: notices created in one
 * transaction share `created_at`, and the RPC refuses `p_before` without `p_before_id` (22023).
 */
export interface NoticesCursor {
  before: string
  beforeId: string
}

/** The caller's unread notices of the last 90 days, and how many of them are important. */
export async function countMyUnreadNotifications(): Promise<UnreadCount> {
  const { data, error } = await supabase.rpc('count_my_unread_notifications')
  if (error) throw error
  const [row] = z.array(unreadCountSchema).parse(data)
  return row ?? { total: 0, important: 0 }
}

/** One page of the bell's list, and whether another one follows. */
export interface NoticesPage {
  notices: Notice[]
  hasMore: boolean
}

/**
 * One page of the caller's notices, newest first: the newest page for a null cursor. Asks for
 * one row more than a page: that row only says another page follows (so « Charger plus » never
 * leads to an empty page), and is dropped.
 */
export async function listMyNotifications(cursor: NoticesCursor | null): Promise<NoticesPage> {
  const { data, error } = await supabase.rpc('list_my_notifications', {
    p_limit: NOTIFICATIONS_PAGE_SIZE + 1,
    ...(cursor && { p_before: cursor.before, p_before_id: cursor.beforeId }),
  })
  if (error) throw error
  const rows = z.array(noticeSchema).parse(data)
  return { notices: rows.slice(0, NOTIFICATIONS_PAGE_SIZE), hasMore: rows.length > NOTIFICATIONS_PAGE_SIZE }
}

/** Accueil « À surveiller »: the newest important unread notices (90 days, like the count). */
export async function listImportantUnreadNotifications(): Promise<Notice[]> {
  const { data, error } = await supabase.rpc('list_my_notifications', {
    p_importance: 'important',
    p_unread_only: true,
    p_limit: IMPORTANT_NOTICES_LIMIT,
  })
  if (error) throw error
  return z.array(noticeSchema).parse(data)
}

/** Marks these notices read for the caller (at most 200; ids the caller cannot see are ignored). */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids })
  if (error) throw error
}

/** « Tout marquer comme lu »: every notice the caller can see. */
export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_all_notifications_read')
  if (error) throw error
}
