import { describe, expect, it } from 'vitest'
import { EMAIL_UI_STRING_KEYS } from '@pergolas-signature/email-ui'
import { t, type TranslationKey } from '@/i18n'
import type { MailAttachment, MailMessage, MailThread, MailThreadRow } from '../api/inbox'
import { canReplyAll, emailUiText, inboxMessageOf, participants, toMailAction, toMailListRow, toStackMessages } from './email-ui'

const row = (over: Partial<MailThreadRow> = {}): MailThreadRow => ({
  id: 'a0000000-0000-0000-0000-000000000001',
  connection_id: 'c1',
  gmail_thread_id: '18c0001',
  subject: 'Sujet',
  snippet: 'Extrait',
  last_from_name: 'Alice Exemple',
  last_from_address: 'alice@exemple.test',
  last_message_at: '2026-10-12T14:00:00Z',
  message_count: 3,
  unread_count: 1,
  has_attachments: true,
  label_ids: ['INBOX', 'UNREAD', 'STARRED'],
  link_status: 'unlinked',
  ...over,
})

const attachment = (over: Partial<MailAttachment> = {}): MailAttachment => ({
  id: 'att1',
  filename: 'recu.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  content_id: null,
  is_inline: false,
  status: 'stored',
  stored_file_id: 'f1',
  ...over,
})

const message = (over: Partial<MailMessage> = {}): MailMessage => ({
  id: 'm1',
  gmail_message_id: 'g1',
  from_name: 'Alice Exemple',
  from_address: 'alice@exemple.test',
  to: [{ name: null, address: 'info@clinique.test' }],
  cc: [],
  reply_to_address: null,
  subject: 'Sujet',
  snippet: 'Extrait',
  sent_at: '2026-10-12T14:00:00Z',
  label_ids: ['INBOX'],
  is_unread: true,
  is_inbound: true,
  body_html: '<p>Bonjour</p>',
  body_text: 'Bonjour',
  body_purged: false,
  attachments: [],
  ...over,
})

const thread = (messages: MailMessage[]): MailThread => ({
  id: 'a0000000-0000-0000-0000-000000000001',
  connection_id: 'c1',
  mailbox: 'info@clinique.test',
  gmail_thread_id: '18c0001',
  subject: 'Sujet',
  label_ids: ['INBOX'],
  message_count: messages.length,
  unread_count: 0,
  link_status: 'unlinked',
  messages,
})

describe('the kit’s words', () => {
  it('fr-CA has every key the kit asks for (a plural one as _one and _other)', () => {
    const missing = EMAIL_UI_STRING_KEYS.filter((key) => {
      const path = `modules.communications.emailUi.${key}`
      const has = (p: string) => t(p as TranslationKey) !== p
      return !has(path) && !(has(`${path}_one`) && has(`${path}_other`))
    })
    expect(missing).toEqual([])
  })

  it('picks the French plural form from a numeric count (0 and 1 singular)', () => {
    expect(emailUiText('mailThread.attachmentCount', { count: 0 })).toBe('0 pièce jointe')
    expect(emailUiText('mailThread.attachmentCount', { count: 1 })).toBe('1 pièce jointe')
    expect(emailUiText('mailThread.attachmentCount', { count: 3 })).toBe('3 pièces jointes')
    expect(emailUiText('email.thread.previousMessagesCount', { count: 2 })).toBe('2 messages précédents')
    expect(emailUiText('mailThread.archive')).toBe('Archiver')
  })
})

describe('actions', () => {
  it('maps the kit’s actions to gmail-modify’s, and refuses the ones it cannot do', () => {
    expect(toMailAction('archive')).toEqual({ kind: 'archive' })
    expect(toMailAction('unarchive')).toEqual({ kind: 'inbox' })
    expect(toMailAction('read')).toEqual({ kind: 'read' })
    expect(toMailAction('unstar')).toEqual({ kind: 'unstar' })
    expect(toMailAction('delete')).toBeNull()
    expect(toMailAction('spam')).toBeNull()
    expect(toMailAction('unspam')).toBeNull()
  })
})

describe('toMailListRow', () => {
  it('keys the row by MANA’s thread id and carries its flags', () => {
    const mapped = toMailListRow(row())
    expect(mapped).toMatchObject({
      id: 'a0000000-0000-0000-0000-000000000001',
      gmail_thread_id: 'a0000000-0000-0000-0000-000000000001',
      gmail_message_id: 'a0000000-0000-0000-0000-000000000001',
      from_name: 'Alice Exemple',
      is_read: false,
      thread_has_unread: true,
      is_starred: true,
      thread_is_starred: true,
      thread_count: 3,
      direction: 'inbound',
      gmail_date: '2026-10-12T14:00:00Z',
    })
  })

  it('is the same object for the same row (the kit’s rows are memoized)', () => {
    const source = row()
    expect(toMailListRow(source)).toBe(toMailListRow(source))
  })

  it('drops DRAFT (a thread with a draft reply stays a thread) and names an unknown sender', () => {
    const mapped = toMailListRow(row({ label_ids: ['INBOX', 'DRAFT'], last_from_name: null, last_from_address: null }))
    expect(mapped.gmail_labels).toEqual(['INBOX'])
    expect(mapped.from_name).toBe(t('modules.communications.inbox.list.unknownSender'))
  })
})

describe('toStackMessages', () => {
  it('lists files without the inline images, keeps MANA’s message and the Gmail link', () => {
    const [mapped] = toStackMessages(
      thread([message({ attachments: [attachment(), attachment({ id: 'logo', is_inline: true, content_id: 'logo@x' })] })]),
    )
    expect(mapped!.attachments).toEqual([{ id: 'att1', filename: 'recu.pdf', mime_type: 'application/pdf', size: 2048 }])
    expect(mapped!.is_read).toBe(false)
    expect(inboxMessageOf(mapped!)?.source.id).toBe('m1')
    expect(inboxMessageOf(mapped!)?.gmailUrl).toBe('https://mail.google.com/mail/?authuser=info%40clinique.test#all/18c0001')
  })

  it('a purged body is no body', () => {
    const [mapped] = toStackMessages(thread([message({ body_purged: true })]))
    expect(mapped!.body_html).toBeNull()
    expect(mapped!.body_text).toBeNull()
  })

  it('a message not from MANA has no MANA side', () => {
    const plain: Record<string, unknown> = { ...toStackMessages(thread([message()]))[0]! }
    delete plain.source
    delete plain.gmailUrl
    expect(inboxMessageOf(plain as never)).toBeNull()
  })
})

describe('the thread’s header and reply', () => {
  it('« Répondre à tous » only when someone else besides the sender is on the answered message', () => {
    expect(canReplyAll(thread([message()]))).toBe(false)
    expect(canReplyAll(thread([message({ cc: [{ name: null, address: 'bruno@exemple.test' }] })]))).toBe(true)
  })

  it('names who is on the thread, once each', () => {
    expect(participants(thread([message(), message({ id: 'm2', from_name: null, from_address: 'info@clinique.test' }), message({ id: 'm3' })]))).toBe(
      'Alice Exemple, info@clinique.test',
    )
  })
})
