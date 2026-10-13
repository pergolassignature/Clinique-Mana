import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import type { MailMessage, MailThread } from '../api/inbox'
import { hasText, initialContent, parseAddresses, prefixedSubject, quoteHtml, replyRecipients, sendProblem, textToHtml } from './compose'

const message = (over: Partial<MailMessage> = {}): MailMessage => ({
  id: 'm1',
  gmail_message_id: 'g1',
  from_name: 'Alice Exemple',
  from_address: 'alice@exemple.test',
  to: [{ name: null, address: 'info@clinique.test' }, { name: 'Bruno', address: 'Bruno@Exemple.test' }],
  cc: [{ name: null, address: 'chloe@exemple.test' }],
  reply_to_address: null,
  subject: 'Rendez-vous',
  snippet: 'Bonjour',
  sent_at: '2026-10-12T14:00:00Z',
  label_ids: ['INBOX'],
  is_unread: false,
  is_inbound: true,
  body_html: '<p>Bonjour <img src="https://pixel.test/x.gif"></p>',
  body_text: 'Bonjour,\n\nJe voudrais un rendez-vous.',
  body_purged: false,
  attachments: [],
  ...over,
})

const thread = (messages: MailMessage[]): MailThread => ({
  id: 't1',
  connection_id: 'c1',
  mailbox: 'info@clinique.test',
  gmail_thread_id: 'g-t1',
  subject: 'Rendez-vous',
  label_ids: ['INBOX'],
  message_count: messages.length,
  unread_count: 0,
  link_status: 'linked',
  messages,
})

describe('addresses', () => {
  it('reads what is typed: separators, a name with its address, case, duplicates, mistakes', () => {
    expect(parseAddresses('Alice <Alice@Exemple.test>; bruno@exemple.test, alice@exemple.test  zoe@x.test\npas-une-adresse')).toEqual({
      valid: ['alice@exemple.test', 'bruno@exemple.test', 'zoe@x.test'],
      invalid: ['pas-une-adresse'],
    })
  })

  it('« Répondre » goes to the sender (or Reply-To); « Répondre à tous » adds the others in Cc, never the mailbox', () => {
    expect(replyRecipients(message(), 'info@clinique.test', false)).toEqual({ to: ['alice@exemple.test'], cc: [] })
    expect(replyRecipients(message({ reply_to_address: 'secretariat@exemple.test' }), 'info@clinique.test', false).to).toEqual([
      'secretariat@exemple.test',
    ])
    expect(replyRecipients(message(), 'INFO@clinique.test', true)).toEqual({
      to: ['alice@exemple.test'],
      cc: ['bruno@exemple.test', 'chloe@exemple.test'],
    })
    // A message the mailbox sent: the reply goes to its recipients again.
    expect(replyRecipients(message({ is_inbound: false, from_address: 'info@clinique.test' }), 'info@clinique.test', false).to).toEqual([
      'bruno@exemple.test',
    ])
  })
})

describe('subject and quote', () => {
  it('prefixes once', () => {
    expect(prefixedSubject('Rendez-vous', 'reply')).toBe(`${t('modules.communications.composer.prefixReply')} Rendez-vous`)
    expect(prefixedSubject('RE: Rendez-vous', 'reply_all')).toBe('RE: Rendez-vous')
    expect(prefixedSubject('Fwd: Reçu', 'forward')).toBe('Fwd: Reçu')
    expect(prefixedSubject('Reçu', 'forward')).toBe(`${t('modules.communications.composer.prefixForward')} Reçu`)
    expect(prefixedSubject(' Objet ', 'new')).toBe('Objet')
  })

  it('quotes the text of the message, never its HTML (nothing remote comes along)', () => {
    const quote = quoteHtml(message(), 'reply')
    expect(quote).toContain('<blockquote><p>Bonjour,</p><p>Je voudrais un rendez-vous.</p></blockquote>')
    expect(quote).not.toContain('pixel.test')
    expect(quoteHtml(message(), 'forward')).toContain(t('modules.communications.composer.forwardHeader'))
  })

  it('a {{ in the quoted text or its subject is not a placeholder: never filled, never refused', () => {
    const quoted = message({ subject: 'Tarifs {{2027}}', body_text: 'Mon code est {{person.first_name}}.' })
    const reply = quoteHtml(quoted, 'reply')
    expect(reply).not.toContain('{{')
    expect(reply).toContain('Mon code est {\u200B{person.first_name}\u200B}.')
    expect(quoteHtml(quoted, 'forward')).not.toMatch(/\{\{|\}\}/)
    expect(prefixedSubject('Tarifs {{2027}}', 'reply')).not.toContain('{{')
    expect(prefixedSubject('Tarifs {{2027}}', 'new')).toBe('Tarifs {{2027}}')
  })

  it('a template’s text as paragraphs, escaped', () => {
    expect(textToHtml('Bonjour {{person.first_name}},\n\nMerci <3\nÀ bientôt')).toBe('<p>Bonjour {{person.first_name}},</p><p>Merci &lt;3<br>À bientôt</p>')
    expect(hasText('<p></p><p>&nbsp;</p>')).toBe(false)
  })
})

describe('initialContent and sendProblem', () => {
  it('a reply answers the latest message received, in its thread', () => {
    const content = initialContent({
      connectionId: 'c1',
      mode: 'reply',
      thread: thread([message(), message({ id: 'm2', is_inbound: false, from_address: 'info@clinique.test' })]),
      mailbox: 'info@clinique.test',
    })
    expect(content).toMatchObject({ mode: 'reply', threadId: 't1', replyToMessageId: 'm1', to: ['alice@exemple.test'] })
  })

  it('a forward carries the stored attachments only, and no recipient', () => {
    const content = initialContent({
      connectionId: 'c1',
      mode: 'forward',
      thread: thread([
        message({
          attachments: [
            { id: 'a1', filename: 'recu.pdf', mime_type: 'application/pdf', size_bytes: 10, content_id: null, is_inline: false, status: 'stored', stored_file_id: 'f1' },
            { id: 'a2', filename: 'x.zip', mime_type: 'application/zip', size_bytes: 10, content_id: null, is_inline: false, status: 'unsupported_type', stored_file_id: null },
          ],
        }),
      ]),
      mailbox: 'info@clinique.test',
    })
    expect(content.to).toEqual([])
    expect(content.attachments).toEqual([{ id: 'f1', name: 'recu.pdf', mime_type: 'application/pdf', size_bytes: 10 }])
  })

  it('says what is missing before the countdown', () => {
    const base = initialContent({ connectionId: 'c1', mode: 'new' })
    expect(sendProblem(base)).toBe(t('modules.communications.composer.problems.noRecipient'))
    expect(sendProblem({ ...base, to: ['a@b.test'] })).toBe(t('modules.communications.composer.problems.noSubject'))
    expect(sendProblem({ ...base, to: ['a@b.test'], subject: 'Objet' })).toBe(t('modules.communications.composer.problems.noBody'))
    expect(sendProblem({ ...base, to: ['a@b.test'], subject: 'Objet', bodyHtml: '<p>Texte</p>' })).toBeNull()
  })
})
