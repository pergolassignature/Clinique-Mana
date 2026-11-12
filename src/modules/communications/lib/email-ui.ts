import type {
  EmailUiStringKey,
  MailAction as KitAction,
  MailListRow,
  MailThreadMessage,
  ThreadStackMessage,
} from '@pergolas-signature/email-ui'
import { t, type TranslationKey } from '@/i18n'
import type { MailAction, MailMessage, MailThread, MailThreadRow } from '../api/inbox'
import { messageToAnswer, replyRecipients } from './compose'
import { gmailThreadUrl } from './inbox-format'

/*
 * MANA's side of `@pergolas-signature/email-ui` (the mail list and thread kit, PS Hub's ADR-0467): how
 * the inbox's rows, messages, actions and words become the kit's. Pure: the ports and slots that use
 * it are in `components/inbox/email-ui-ports.ts`.
 *
 * - The kit names a thread by `gmail_thread_id`, a key it only hands back (row key, `modify`, hover).
 *   MANA puts its own thread id there: what `?fil=` and `gmail-modify` take.
 * - A row is a thread here, not a message: its key, its selection id and its `id` are all the thread.
 */

/** The kit's words live under this key of `fr-CA.json`, in the kit's own key paths. */
const WORDS = 'modules.communications.emailUi'

/** French plural categories (CLDR): 0 and 1 are singular, « 0 pièce jointe ». */
const plural = new Intl.PluralRules('fr-CA')

/**
 * The kit's `t`: its key under `modules.communications.emailUi`; a numeric `count` picks the
 * `_one` / `_other` form (the kit's i18next convention), every value goes in as text.
 */
export function emailUiText(key: EmailUiStringKey, values?: Record<string, unknown>): string {
  const count = values?.count
  const path = typeof count === 'number' ? `${WORDS}.${key}_${plural.select(count) === 'one' ? 'one' : 'other'}` : `${WORDS}.${key}`
  if (!values) return t(path as TranslationKey)
  return t(path as TranslationKey, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])))
}

/** What `gmail-modify` can do, in the kit's names: the selection toolbar offers these only. */
export const BATCH_ACTIONS: KitAction[] = ['archive', 'unarchive', 'star', 'read', 'unread']

/** A kit action as `gmail-modify`'s, or null for one it has no counterpart for (delete, spam). */
export function toMailAction(action: KitAction): MailAction | null {
  switch (action) {
    case 'archive':
    case 'read':
    case 'unread':
    case 'star':
    case 'unstar':
      return { kind: action }
    case 'unarchive':
      return { kind: 'inbox' }
    default:
      return null
  }
}

const rows = new WeakMap<MailThreadRow, MailListRow>()

/**
 * One list row as the kit draws it. Memoized on the row object: React Query keeps an unchanged
 * row the same object across refetches, so the kit's memoized row keeps its props and does not
 * repaint. A thread with neither a name nor an address is from « (expéditeur inconnu) ».
 */
export function toMailListRow(row: MailThreadRow): MailListRow {
  const cached = rows.get(row)
  if (cached) return cached
  const unread = row.unread_count > 0
  const starred = row.label_ids.includes('STARRED')
  const mapped: MailListRow = {
    id: row.id,
    gmail_message_id: row.id,
    gmail_thread_id: row.id,
    connection_id: row.connection_id,
    from_email: row.last_from_address ?? '',
    from_name: row.last_from_name?.trim() || (row.last_from_address ? null : t('modules.communications.inbox.list.unknownSender')),
    // The list has no recipients: every row names its last sender (« À : … » would need them).
    to_emails: [],
    cc_emails: null,
    subject: row.subject,
    snippet: row.snippet,
    gmail_date: row.last_message_at,
    // A thread with a draft reply is still a thread: the kit would open DRAFT rows in a composer.
    gmail_labels: row.label_ids.filter((label) => label !== 'DRAFT'),
    is_read: !unread,
    is_starred: starred,
    has_attachments: row.has_attachments,
    direction: 'inbound',
    thread_count: row.message_count,
    thread_has_unread: unread,
    thread_has_attachments: row.has_attachments,
    thread_is_starred: starred,
  }
  rows.set(row, mapped)
  return mapped
}

/** A message of the open thread as the kit draws it, with what MANA's slots need. */
export interface InboxStackMessage extends ThreadStackMessage {
  /** MANA's own message: its attachments' states, its purged body. */
  source: MailMessage
  /** The thread in Gmail, for a file only Gmail has. */
  gmailUrl: string
}

/** MANA's side of a kit message (the slots receive the kit's type), or null for any other. */
export function inboxMessageOf(message: MailThreadMessage): InboxStackMessage | null {
  return 'source' in message && 'gmailUrl' in message ? (message as InboxStackMessage) : null
}

const addresses = (list: MailMessage['to']) => list.map((r) => r.address).filter((a): a is string => !!a)

/**
 * The thread's messages, oldest first. Inline images are not files (the body shows them), and a
 * purged body is no body: the slot says so from `source`.
 */
export function toStackMessages(thread: MailThread): InboxStackMessage[] {
  const gmailUrl = gmailThreadUrl(thread.mailbox, thread.gmail_thread_id)
  return thread.messages.map((m) => ({
    id: m.id,
    is_read: !m.is_unread,
    gmail_message_id: m.gmail_message_id,
    from_email: m.from_address ?? '',
    from_name: m.from_name,
    to_emails: addresses(m.to),
    cc_emails: addresses(m.cc),
    bcc_emails: null,
    snippet: m.snippet,
    gmail_date: m.sent_at,
    body_html: m.body_purged ? null : m.body_html,
    body_text: m.body_purged ? null : m.body_text,
    direction: m.is_inbound ? 'inbound' : 'outbound',
    attachments: m.attachments
      .filter((a) => !a.is_inline)
      .map((a) => ({ id: a.id, filename: a.filename?.trim() || '', mime_type: a.mime_type ?? '', size: a.size_bytes ?? 0 })),
    source: m,
    gmailUrl,
  }))
}

/** « Répondre à tous » has someone to add: the answered message has more than one other person on it. */
export function canReplyAll(thread: MailThread): boolean {
  const answered = messageToAnswer(thread)
  if (!answered) return false
  const { to, cc } = replyRecipients(answered, thread.mailbox, true)
  return to.length + cc.length > 1
}

/** Who is on the thread, by name, for the header's second line. */
export function participants(thread: MailThread): string {
  const names = new Set<string>()
  for (const m of thread.messages) {
    const name = m.from_name?.trim() || m.from_address
    if (name) names.add(name)
  }
  return [...names].join(', ')
}
