/**
 * The message `gmail-send` hands Gmail (CM3, CM-15, CM-16): placeholders
 * filled on the server, the composer's HTML hardened, a plain-text
 * alternative, and the RFC 5322 / MIME bytes built here (PS Hub's
 * `mime-builder.ts`, without its URL fetches: every attachment is bytes we
 * already hold). Pure: no fetch, no env.
 *
 * - Headers never carry a CR or LF from the input (header injection): the
 *   addresses are checked, names and the subject are folded to one line and
 *   written as RFC 2047 encoded words when they are not plain ASCII.
 * - Bodies are UTF-8 in base64 (76-character lines); attachments base64,
 *   their names in RFC 2231 (`filename*=UTF-8''…`) with an ASCII fallback.
 * - Structure: `multipart/alternative` (text, HTML), inside
 *   `multipart/mixed` when there are attachments.
 */

/** The composer's placeholders and their values (`prepare_mail_send`). */
export type PlaceholderValues = Record<string, string | null>

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*\}\}/g

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/**
 * Fills `{{ path }}` with its value (escaped for HTML when `html`). A path
 * without a value throws: the database refused those already, so this is a
 * contract break, never a blank sent to a client.
 */
export function fillPlaceholders(
  text: string,
  values: PlaceholderValues,
  options: { html: boolean },
): string {
  return text.replace(PLACEHOLDER, (_all, path: string) => {
    const value = values[path]
    if (value === undefined || value === null) {
      throw new Error(`placeholder_without_value:${path}`)
    }
    const oneLine = options.html ? value : value.replace(/[\r\n]+/g, ' ')
    return options.html ? escapeHtml(oneLine) : oneLine
  })
}

/**
 * Hardens the composer's HTML (TipTap's output is already a small schema; this
 * is the server's own line): no script, style, iframe, object, embed, form or
 * base element, no `on…` attribute, no `javascript:` / `data:` / `vbscript:`
 * link or source, no `srcdoc`.
 */
export function hardenHtml(html: string): string {
  return html
    .replace(
      /<(script|style|iframe|object|embed|form|template|noscript)\b[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(
      /<\/?(script|style|iframe|object|embed|form|template|noscript|base|meta|link|input|button|textarea|select)\b[^>]*>/gi,
      '',
    )
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+srcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s+(href|src|action|formaction|xlink:href)\s*=\s*("\s*(?:javascript|vbscript|data):[^"]*"|'\s*(?:javascript|vbscript|data):[^']*'|(?:javascript|vbscript|data):[^\s>]*)/gi,
      '',
    )
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
}

/** The plain-text alternative: paragraphs and line breaks kept, links written out. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(
      /<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_all, href: string, label: string) => {
        const text = label.replace(/<[^>]*>/g, '').trim()
        return text && text !== href ? `${text} (${href})` : href
      },
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|blockquote|ul|ol|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(#\d+|#x[0-9a-f]+|[a-z]+);/gi,
      (all, name: string) => {
        if (/^#x/i.test(name)) {
          return String.fromCodePoint(parseInt(name.slice(2), 16))
        }
        if (/^#\d+$/.test(name)) {
          return String.fromCodePoint(Number(name.slice(1)))
        }
        return ENTITIES[name.toLowerCase()] ?? all
      },
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One address with an optional display name. */
export interface MailAddress {
  name?: string | null
  address: string
}

export interface OutgoingAttachment {
  name: string
  mimeType: string
  bytes: Uint8Array
}

export interface OutgoingMessage {
  from: MailAddress
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  html: string
  text: string
  /** The answered message's `Message-ID` (a reply), and the thread's chain. */
  inReplyTo?: string | null
  references?: string | null
  attachments: OutgoingAttachment[]
  /**
   * The `Message-ID`'s left part (`<messageId@domain>`): the send's own id, the
   * same on every try, so a try after an unanswered one can ask Gmail whether
   * it went. Else random.
   */
  messageId?: string
  /** For the boundaries (and the `Message-ID` without `messageId`). */
  random: () => string
  date: Date
}

const ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/
const MESSAGE_ID = /^<[^<>\s]{1,250}>$/
/** At most this many References (the first and the latest, RFC 5322 §3.6.4). */
const MAX_REFERENCES = 20

/**
 * The References chain: valid ids only (a malformed one from another mail
 * program is dropped, never a reason to refuse the reply), the first and the
 * latest when it is long, one per folded line.
 */
export function referencesHeader(
  references: string | null | undefined,
): string | null {
  const ids = (references ?? '').split(/\s+/).filter((id) =>
    MESSAGE_ID.test(id)
  )
  if (ids.length === 0) return null
  const kept = ids.length > MAX_REFERENCES
    ? [ids[0], ...ids.slice(ids.length - (MAX_REFERENCES - 1))]
    : ids
  return kept.join('\r\n ')
}

const encoder = new TextEncoder()

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Base64 in lines of 76 characters (RFC 2045). */
function base64Lines(bytes: Uint8Array): string {
  return (base64(bytes).match(/.{1,76}/g) ?? []).join('\r\n')
}

const isPlainAscii = (text: string) => /^[\x20-\x7e]*$/.test(text)

/** A header value on one line, as an RFC 2047 encoded word when it is not plain ASCII. */
export function encodeWord(text: string): string {
  const oneLine = text.replace(/[\r\n\t]+/g, ' ').trim()
  if (isPlainAscii(oneLine)) return oneLine
  // Encoded words of at most 75 characters: chunks of whole characters, 45 bytes each.
  const words: string[] = []
  let chunk = ''
  for (const char of oneLine) {
    if (encoder.encode(chunk + char).length > 45) {
      words.push(`=?UTF-8?B?${base64(encoder.encode(chunk))}?=`)
      chunk = ''
    }
    chunk += char
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(encoder.encode(chunk))}?=`)
  return words.join('\r\n ')
}

function formatAddress(a: MailAddress): string {
  if (!ADDRESS.test(a.address)) throw new Error('invalid_address')
  const name = a.name?.replace(/[\r\n"\\]+/g, ' ').trim()
  if (!name) return a.address
  return isPlainAscii(name)
    ? `"${name}" <${a.address}>`
    : `${encodeWord(name)} <${a.address}>`
}

function addressList(list: string[]): string {
  return list.map((address) => formatAddress({ address })).join(', ')
}

/** `filename*=UTF-8''…` (RFC 2231) with an ASCII `filename=` beside it. */
function fileNameParams(name: string): string {
  const clean = name.replace(/[\r\n"\\/]+/g, '_').trim() || 'piece-jointe'
  const ascii = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** The message as RFC 5322 bytes (CRLF line ends). */
export function buildMime(message: OutgoingMessage): Uint8Array {
  if (message.to.length === 0) throw new Error('no_recipient')
  if (
    message.messageId !== undefined &&
    !/^[A-Za-z0-9.-]{1,100}$/.test(message.messageId)
  ) {
    throw new Error('invalid_message_id')
  }
  const inReplyTo = message.inReplyTo && MESSAGE_ID.test(message.inReplyTo)
    ? message.inReplyTo
    : null
  const references = referencesHeader(message.references)
  const domain = message.from.address.split('@')[1]
  const headers = [
    `From: ${formatAddress(message.from)}`,
    `To: ${addressList(message.to)}`,
    ...(message.cc.length ? [`Cc: ${addressList(message.cc)}`] : []),
    // Gmail strips Bcc from what the other recipients receive.
    ...(message.bcc.length ? [`Bcc: ${addressList(message.bcc)}`] : []),
    `Subject: ${encodeWord(message.subject)}`,
    `Date: ${message.date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${message.messageId ?? message.random()}@${domain}>`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
  ]
  const alternative = `alt_${message.random()}`
  const alternativeBody = [
    `--${alternative}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(encoder.encode(message.text)),
    `--${alternative}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(encoder.encode(message.html)),
    `--${alternative}--`,
    '',
  ].join('\r\n')

  let lines: string[]
  if (message.attachments.length === 0) {
    lines = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      '',
      alternativeBody,
    ]
  } else {
    const mixed = `mix_${message.random()}`
    lines = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      '',
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      '',
      alternativeBody,
    ]
    for (const a of message.attachments) {
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(a.mimeType)) {
        throw new Error('invalid_mime_type')
      }
      lines.push(
        `--${mixed}`,
        `Content-Type: ${a.mimeType}`,
        `Content-Disposition: attachment; ${fileNameParams(a.name)}`,
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(a.bytes),
      )
    }
    lines.push(`--${mixed}--`, '')
  }
  return encoder.encode(lines.join('\r\n'))
}
