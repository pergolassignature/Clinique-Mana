/**
 * The inbox's actions on a thread (plan §11, CM2; `gmail-modify`), as Gmail
 * does them: what to ask Gmail and what the mirror then records
 * (`apply_mail_label_changes`). Pure: no I/O.
 *
 * - `read`: UNREAD removed from the unread messages (`messages.batchModify`);
 * - `unread`: UNREAD added to the latest message (Gmail marks the last one);
 * - `archive`: INBOX removed from the thread (`threads.modify`);
 * - `inbox`: INBOX added to the thread (« Remettre dans la boîte »);
 * - `star`: STARRED added to the latest message; `unstar`: removed from every
 *   starred one;
 * - `label` / `unlabel`: a user label (`Label_…`) on the whole thread.
 *
 * A no-op (reading a read thread) asks Gmail nothing.
 */
import { z } from 'zod'

/** A user label's Gmail id. System labels are reached through the named actions only. */
export const USER_LABEL = /^Label_[A-Za-z0-9_-]{1,64}$/

export const mailActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['read', 'unread', 'archive', 'inbox', 'star', 'unstar']),
  }),
  z.strictObject({
    kind: z.enum(['label', 'unlabel']),
    label_id: z.string().regex(USER_LABEL),
  }),
])
export type MailAction = z.infer<typeof mailActionSchema>

export interface ThreadForAction {
  gmail_thread_id: string
  /** Oldest first. */
  messages: { gmail_message_id: string; label_ids: string[] }[]
}

export type GmailCall =
  | { type: 'thread'; add: string[]; remove: string[] }
  | { type: 'messages'; ids: string[]; add: string[]; remove: string[] }

export interface ActionPlan {
  /** Null: nothing to change. */
  gmail: GmailCall | null
  /** The mirror's changes, per message (CM1's `apply_mail_label_changes` shape). */
  mirror: { gmail_message_id: string; add: string[]; remove: string[] }[]
}

const has = (m: { label_ids: string[] }, label: string) =>
  m.label_ids.includes(label)

/** What `action` asks of Gmail and of the mirror for `thread`. */
export function planAction(
  action: MailAction,
  thread: ThreadForAction,
): ActionPlan {
  const messages = thread.messages
  const last = messages.at(-1)
  const onMessages = (
    targets: { gmail_message_id: string }[],
    add: string[],
    remove: string[],
  ): ActionPlan =>
    targets.length === 0 ? { gmail: null, mirror: [] } : {
      gmail: {
        type: 'messages',
        ids: targets.map((m) => m.gmail_message_id),
        add,
        remove,
      },
      mirror: targets.map((m) => ({
        gmail_message_id: m.gmail_message_id,
        add,
        remove,
      })),
    }
  const onThread = (
    changed: { gmail_message_id: string }[],
    add: string[],
    remove: string[],
  ): ActionPlan =>
    changed.length === 0 ? { gmail: null, mirror: [] } : {
      gmail: { type: 'thread', add, remove },
      mirror: messages.map((m) => ({
        gmail_message_id: m.gmail_message_id,
        add,
        remove,
      })),
    }

  switch (action.kind) {
    case 'read':
      return onMessages(messages.filter((m) => has(m, 'UNREAD')), [], [
        'UNREAD',
      ])
    case 'unread':
      return onMessages(last && !has(last, 'UNREAD') ? [last] : [], [
        'UNREAD',
      ], [])
    case 'archive':
      return onThread(messages.filter((m) => has(m, 'INBOX')), [], ['INBOX'])
    case 'inbox':
      return onThread(messages.filter((m) => !has(m, 'INBOX')), ['INBOX'], [])
    case 'star':
      return onMessages(last && !has(last, 'STARRED') ? [last] : [], [
        'STARRED',
      ], [])
    case 'unstar':
      return onMessages(messages.filter((m) => has(m, 'STARRED')), [], [
        'STARRED',
      ])
    case 'label':
      return onThread(
        messages.filter((m) => !has(m, action.label_id)),
        [action.label_id],
        [],
      )
    case 'unlabel':
      return onThread(
        messages.filter((m) => has(m, action.label_id)),
        [],
        [action.label_id],
      )
  }
}
