import { t } from '@/i18n'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import type { MailMessage, MailThread } from '../api/inbox'
import type { ComposeMode, DraftContent } from '../api/composer'

/*
 * The composer's pure rules (CM3): who a reply goes to, its subject and its quote, a template's
 * text as HTML, the addresses typed. The server checks again: these only prefill and warn.
 */

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/

/** An address as the database keeps it, or null when it is not one. */
export function normalizeAddress(raw: string): string | null {
  const bracketed = /<([^<>]+)>\s*$/.exec(raw)
  const address = (bracketed?.[1] ?? raw).trim().toLowerCase()
  return ADDRESS.test(address) && address.length <= 254 ? address : null
}

/** What is typed in « À », « Cc » or « Cci »: separated by commas, semicolons, spaces or lines. */
export function parseAddresses(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  for (const part of text.split(/[,;\n]+|\s+(?=[^\s<>]+@)/)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const address = normalizeAddress(trimmed)
    if (address === null) invalid.push(trimmed)
    else if (!valid.includes(address)) valid.push(address)
  }
  return { valid, invalid }
}

/** The message a reply answers: the latest one received, else the latest. */
export function messageToAnswer(thread: MailThread): MailMessage | null {
  const inbound = thread.messages.filter((m) => m.is_inbound)
  return inbound[inbound.length - 1] ?? thread.messages[thread.messages.length - 1] ?? null
}

/**
 * Who a reply goes to. « Répondre »: the message's Reply-To, else its sender (for a message the
 * mailbox sent, its recipients). « Répondre à tous »: also its other recipients in Cc. Never the
 * mailbox itself.
 */
export function replyRecipients(message: MailMessage, mailbox: string, all: boolean): { to: string[]; cc: string[] } {
  const own = mailbox.toLowerCase()
  const clean = (list: (string | null | undefined)[]) =>
    [...new Set(list.map((a) => (a ? normalizeAddress(a) : null)).filter((a): a is string => a !== null && a !== own))]
  const recipients = clean(message.to.map((r) => r.address))
  const to = message.is_inbound ? clean([message.reply_to_address ?? message.from_address]) : recipients
  if (!all) return { to, cc: [] }
  const cc = clean([...(message.is_inbound ? recipients : []), ...message.cc.map((r) => r.address)]).filter((a) => !to.includes(a))
  return { to, cc }
}

/**
 * Someone else's text (a quoted message, its subject): a `{{` in it is not a placeholder, so it is
 * broken with a zero-width space — never filled by the server, never a reason to refuse the send.
 */
export function inertPlaceholders(text: string): string {
  return text.replaceAll('{{', '{\u200B{').replaceAll('}}', '}\u200B}')
}

/** « Re : … » / « TR : … », once (the French prefixes and Gmail's English ones are recognised). */
export function prefixedSubject(subject: string | null, mode: ComposeMode): string {
  const base = (subject ?? '').trim()
  if (mode === 'new') return base
  const prefix = mode === 'forward' ? t('modules.communications.composer.prefixForward') : t('modules.communications.composer.prefixReply')
  const already = mode === 'forward' ? /^(tr|fwd?)\s*:/i : /^(re)\s*:/i
  const subjectText = inertPlaceholders(base)
  return already.test(subjectText) ? subjectText : `${prefix} ${subjectText}`.trim()
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** A template's plain text (core's catalogue) as the composer's HTML: one paragraph per blank line. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('')
}

/** The quoted message under a reply or a forward (its text, never its HTML: nothing remote comes along). */
export function quoteHtml(message: MailMessage, mode: ComposeMode): string {
  const from = inertPlaceholders(
    message.from_name?.trim() ? `${message.from_name} <${message.from_address ?? ''}>` : (message.from_address ?? ''),
  )
  const date = formatClinicDateTime(message.sent_at)
  const text = inertPlaceholders(message.body_text?.trim() || message.snippet?.trim() || '')
  const body = textToHtml(text)
  if (mode === 'forward') {
    const header = [
      t('modules.communications.composer.forwardHeader'),
      t('modules.communications.composer.forwardFrom', { from }),
      t('modules.communications.composer.forwardDate', { date }),
      t('modules.communications.composer.forwardSubject', { subject: inertPlaceholders(message.subject ?? '') }),
    ]
      .map(escapeHtml)
      .join('<br>')
    return `<p></p><p>${header}</p>${body}`
  }
  return `<p></p><p>${escapeHtml(t('modules.communications.composer.replyHeader', { date, from }))}</p><blockquote>${body}</blockquote>`
}

/** The composer's HTML as plain text (« Rédiger avec l'IA » sends text, never HTML): paragraphs, lines. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  doc.querySelectorAll('p, div, li, blockquote, h1, h2, h3').forEach((el) => el.append('\n\n'))
  return (doc.body.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Whether the body says something (not only empty paragraphs). */
export function hasText(html: string): boolean {
  return html.replace(/<[^>]*>|&nbsp;/g, '').trim() !== ''
}

/** What « Envoyer » checks before the countdown (the server checks the rest). */
export function sendProblem(content: DraftContent): string | null {
  if (content.to.length === 0) return t('modules.communications.composer.problems.noRecipient')
  if (!content.subject.trim()) return t('modules.communications.composer.problems.noSubject')
  if (!hasText(content.bodyHtml) && content.mode !== 'forward') return t('modules.communications.composer.problems.noBody')
  return null
}

/** The draft's content for one open of the composer (a reply, a forward, a new message). */
export function initialContent(options: {
  connectionId: string
  mode: ComposeMode
  thread?: MailThread | null
  mailbox?: string
  clientId?: string | null
  to?: string[]
}): DraftContent {
  const { connectionId, mode, thread = null, mailbox = '', clientId = null, to = [] } = options
  const message = thread ? messageToAnswer(thread) : null
  if (!thread || !message || mode === 'new') {
    return {
      connectionId,
      mode: 'new',
      threadId: null,
      replyToMessageId: null,
      clientId,
      to,
      cc: [],
      bcc: [],
      subject: '',
      bodyHtml: '',
      attachments: [],
    }
  }
  const recipients = mode === 'forward' ? { to: [], cc: [] } : replyRecipients(message, mailbox, mode === 'reply_all')
  return {
    connectionId,
    mode,
    threadId: thread.id,
    replyToMessageId: message.id,
    clientId,
    to: recipients.to,
    cc: recipients.cc,
    bcc: [],
    subject: prefixedSubject(thread.subject, mode),
    bodyHtml: quoteHtml(message, mode),
    // A forward carries the message's stored attachments (our copies; never refetched from Gmail).
    attachments:
      mode === 'forward'
        ? message.attachments
            .filter((a) => !a.is_inline && a.status === 'stored' && a.stored_file_id)
            .map((a) => ({ id: a.stored_file_id as string, name: a.filename ?? 'piece-jointe', mime_type: a.mime_type ?? '', size_bytes: a.size_bytes ?? 0 }))
        : [],
  }
}
