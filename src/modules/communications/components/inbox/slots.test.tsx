// @vitest-environment jsdom
// jsdom: the body goes through the real sanitizer (DOMPurify) into the frame's srcdoc.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import type { MailAttachment, MailMessage, MailThread } from '../../api/inbox'
import { toStackMessages } from '../../lib/email-ui'
import { AttachmentSlot } from './AttachmentSlot'
import { MessageBodySlot } from './MessageBodySlot'

const mocks = vi.hoisted(() => ({ useSignedFileUrl: vi.fn(), useSignedFileUrls: vi.fn() }))
vi.mock('@/core/storage/hooks', () => mocks)

const V = 'modules.communications.inbox.thread'

const attachment = (over: Partial<MailAttachment> = {}): MailAttachment => ({
  id: 'att1',
  filename: 'recu.pdf',
  mime_type: 'application/pdf',
  size_bytes: 20_480,
  content_id: null,
  is_inline: false,
  status: 'stored',
  stored_file_id: 'f-recu',
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
  snippet: 'Extrait du courriel',
  sent_at: '2026-10-12T14:00:00Z',
  label_ids: ['INBOX'],
  is_unread: false,
  is_inbound: true,
  body_html: null,
  body_text: null,
  body_purged: false,
  attachments: [],
  ...over,
})

const stacked = (...messages: MailMessage[]) => {
  const thread: MailThread = {
    id: 't1',
    connection_id: 'c1',
    mailbox: 'info@clinique.test',
    gmail_thread_id: '18c0001',
    subject: 'Sujet',
    label_ids: ['INBOX'],
    message_count: messages.length,
    unread_count: 0,
    link_status: 'unlinked',
    messages,
  }
  return toStackMessages(thread)
}

// Each stored file's signed URL names the file.
mocks.useSignedFileUrls.mockImplementation((ids: string[]) => ({ urls: new Map(ids.map((id) => [id, `https://storage.test/${id}`])) }))
mocks.useSignedFileUrl.mockImplementation((id: string | null) => ({ data: id ? { url: `https://storage.test/${id}` } : undefined }))

const srcdoc = (container: HTMLElement) => container.querySelector('iframe')?.getAttribute('srcdoc') ?? ''

describe('MessageBodySlot', () => {
  it('resolves THIS message’s cid: images: two messages sharing a Content-ID each show their own', () => {
    const logo = (id: string, file: string) => attachment({ id, is_inline: true, content_id: 'logo@x', stored_file_id: file, filename: 'logo.png' })
    const [first, second] = stacked(message({ id: 'm1', attachments: [logo('a1', 'f-first')] }), message({ id: 'm2', attachments: [logo('a2', 'f-second')] }))
    const html = '<p>Bonjour</p><img src="cid:logo@x" alt="logo">'
    const one = render(<MessageBodySlot html={html} message={first!} part="reply" />)
    const two = render(<MessageBodySlot html={html} message={second!} part="reply" />)
    expect(srcdoc(one.container)).toContain('https://storage.test/f-first')
    expect(srcdoc(one.container)).not.toContain('f-second')
    expect(srcdoc(two.container)).toContain('https://storage.test/f-second')
  })

  it('sanitizes the raw HTML it is handed', () => {
    const [m] = stacked(message())
    const { container } = render(<MessageBodySlot html={'<p>Texte</p><script>alert(1)</script>'} message={m!} part="reply" />)
    expect(srcdoc(container)).toContain('Texte')
    expect(srcdoc(container)).not.toContain('<script>alert')
  })

  it('a purged body says so instead of the HTML', () => {
    const [m] = stacked(message({ body_purged: true }))
    const { container } = render(<MessageBodySlot html="" message={m!} part="reply" />)
    expect(screen.getByText(t(`${V}.purged`))).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('an empty body shows its snippet, else « Ce courriel est vide. »; an empty quoted part nothing', () => {
    const [withSnippet] = stacked(message())
    const [bare] = stacked(message({ snippet: null }))
    render(<MessageBodySlot html="" message={withSnippet!} part="reply" />)
    expect(screen.getByText('Extrait du courriel')).toBeInTheDocument()
    render(<MessageBodySlot html="<p> </p>" message={bare!} part="reply" />)
    expect(screen.getByText(t(`${V}.noBody`))).toBeInTheDocument()
    const quoted = render(<MessageBodySlot html="" message={bare!} part="quoted" />)
    expect(quoted.container).toBeEmptyDOMElement()
  })
})

describe('AttachmentSlot', () => {
  const files = [
    attachment(),
    attachment({ id: 'att2', filename: 'photo.heic', status: 'pending', stored_file_id: null }),
    attachment({ id: 'att3', filename: 'dossier.zip', status: 'unsupported_type', stored_file_id: null, size_bytes: 3_000_000 }),
  ]
  const [m] = stacked(message({ attachments: files }))

  it('a stored copy opens through a real link to its signed URL, in a new tab', () => {
    render(<AttachmentSlot attachment={m!.attachments![0] as never} message={m!} />)
    const link = screen.getByRole('link', { name: /recu\.pdf/ })
    expect(link).toHaveAttribute('href', 'https://storage.test/f-recu')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveTextContent(t(`${V}.sizeKb`, { size: '20' }))
  })

  it('a copy being made says « copie en cours »; any other is in Gmail only, with the thread in Gmail', () => {
    const list = Array.isArray(m!.attachments) ? m!.attachments : []
    render(<AttachmentSlot attachment={list[1]!} message={m!} />)
    expect(screen.getByText(new RegExp(t(`${V}.attachmentPending`)))).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    render(<AttachmentSlot attachment={list[2]!} message={m!} />)
    expect(screen.getByText(new RegExp(t(`${V}.attachmentInGmail`)))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${V}.openInGmailShort`) })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/?authuser=info%40clinique.test#all/18c0001',
    )
  })
})
