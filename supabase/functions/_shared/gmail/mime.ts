/**
 * A Gmail message (`format=full`) → the row `upsert_mail_messages` takes.
 *
 * Ported from PS Hub's `gmail-sync` (`extractBody`, `parseEmailAddress`) with
 * its flaws fixed (roadmap §2.4 bis): address lists split on the commas
 * outside quotes and angle brackets (`"Doe, John" <j@x>`), bodies decoded
 * with the part's own charset (ISO-8859-1 mail from older clients), the
 * `References` header kept, a body part Gmail hands out by attachment id
 * (a large body) fetched by the sync, and addresses lower-cased once here.
 *
 * Parts with a file name or an attachment id are attachments; an image whose
 * `Content-ID` the HTML names as `cid:` is inline. An attachment is `accepted`
 * when its type is one the storage map takes (the sync copies those; the
 * others stay in Gmail, listed with their name).
 */
import {
  decodeBase64Url,
  type GmailHeader,
  type GmailMessage,
  type GmailPart,
} from './client.ts'
import { extensionForMime } from '../storage.ts'

/** One address of a header. */
export interface Address {
  name: string | null
  address: string
}

/** One attachment part. */
export interface AttachmentPart {
  part_id: string
  gmail_attachment_id: string | null
  filename: string | null
  mime_type: string | null
  size_bytes: number | null
  content_id: string | null
  is_inline: boolean
  accepted: boolean
}

/** What `upsert_mail_messages` takes for one message. */
export interface ParsedMessage {
  gmail_message_id: string
  gmail_thread_id: string
  rfc_message_id: string | null
  in_reply_to: string | null
  from_name: string | null
  from_address: string | null
  to: Address[]
  cc: Address[]
  bcc: Address[]
  reply_to_address: string | null
  subject: string | null
  snippet: string | null
  sent_at: string
  label_ids: string[]
  body_html: string | null
  body_text: string | null
  size_estimate: number | null
  attachments: AttachmentPart[]
  /** Body parts Gmail returns by attachment id (`body.data` absent): the sync fetches them. */
  body_refs: {
    kind: 'html' | 'text'
    attachment_id: string
    charset: string | null
  }[]
}

const MAX_BODY = 1_048_576
const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

/** The first header with that name (case-insensitive), or null. */
export function header(
  headers: GmailHeader[] | undefined,
  name: string,
): string | null {
  const lower = name.toLowerCase()
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? null
}

/** Splits a header list on the commas outside quotes and angle brackets. */
export function splitAddressList(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let depth = 0
  for (const char of value) {
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '<') depth++
    else if (!quoted && char === '>') depth = Math.max(0, depth - 1)
    if (char === ',' && !quoted && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

/** `Name <a@b>`, `<a@b>`, `a@b`, `"Doe, John" <j@x>` → an address, or null. */
export function parseAddress(raw: string): Address | null {
  const text = raw.trim()
  const angle = /^(.*?)\s*<([^<>]+)>\s*$/.exec(text)
  let name: string | null = null
  let candidate: string
  if (angle) {
    name = angle[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim()
    candidate = angle[2].trim()
  } else {
    candidate = text
  }
  const match = EMAIL.exec(candidate)
  if (!match) return null
  return { name: name === '' ? null : name, address: match[0].toLowerCase() }
}

/** Every address of a list header. */
export function parseAddressList(value: string | null): Address[] {
  if (!value) return []
  return splitAddressList(value).map(parseAddress).filter((a): a is Address =>
    a !== null
  )
}

/** The `charset=` of a `Content-Type` value, lower case, or null. */
export function charsetOf(contentType: string | null): string | null {
  const match = /charset\s*=\s*"?([A-Za-z0-9._-]+)"?/i.exec(contentType ?? '')
  return match ? match[1].toLowerCase() : null
}

/** Decodes a body's bytes with its charset (UTF-8 when unknown or unsupported). */
export function decodeBody(bytes: Uint8Array, charset: string | null): string {
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset ?? 'utf-8')
  } catch {
    decoder = new TextDecoder('utf-8')
  }
  return decoder.decode(bytes)
}

/** A body part's text, capped at 1 MB of characters. */
function bodyText(data: string, charset: string | null): string {
  const text = decodeBody(decodeBase64Url(data), charset)
  return text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text
}

/** Gmail's `internalDate` (ms) as ISO, else the `Date` header, else `fallback`. */
export function sentAt(message: GmailMessage, fallback: Date): string {
  const ms = Number(message.internalDate)
  if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString()
  const parsed = Date.parse(header(message.payload?.headers, 'Date') ?? '')
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : fallback.toISOString()
}

/** `<id>` → `id`. */
const stripAngles = (value: string | null) =>
  value?.trim().replace(/^<|>$/g, '') ?? null

/** Parses one message; `now` is the fallback date. */
export function parseMessage(message: GmailMessage, now: Date): ParsedMessage {
  const headers = message.payload?.headers
  let html: string | null = null
  let text: string | null = null
  const candidates: AttachmentPart[] = []
  const bodyRefs: ParsedMessage['body_refs'] = []

  const walk = (part: GmailPart, index: string) => {
    const mime = (part.mimeType ?? '').toLowerCase()
    const body = part.body ?? {}
    const filename = part.filename ?? ''
    const partId = part.partId ?? index
    const isBody = (mime === 'text/html' || mime === 'text/plain') &&
      filename === ''
    if (isBody) {
      const charset = charsetOf(header(part.headers, 'Content-Type'))
      if (mime === 'text/html' && html === null) {
        if (body.data) html = bodyText(body.data, charset)
        else if (body.attachmentId) {
          bodyRefs.push({
            kind: 'html',
            attachment_id: body.attachmentId,
            charset,
          })
        }
      } else if (mime === 'text/plain' && text === null) {
        if (body.data) text = bodyText(body.data, charset)
        else if (body.attachmentId) {
          bodyRefs.push({
            kind: 'text',
            attachment_id: body.attachmentId,
            charset,
          })
        }
      }
    } else if (body.attachmentId || filename !== '') {
      const contentId = stripAngles(header(part.headers, 'Content-ID'))
      candidates.push({
        part_id: partId,
        gmail_attachment_id: body.attachmentId ?? null,
        filename: filename === '' ? null : filename.slice(0, 255),
        mime_type: mime === '' ? null : mime.split(';')[0].trim(),
        size_bytes: typeof body.size === 'number' ? body.size : null,
        content_id: contentId,
        is_inline: false,
        accepted: extensionForMime(mime.split(';')[0].trim()) !== null,
      })
    }
    part.parts?.forEach((child, i) => walk(child, `${index}.${i + 1}`))
  }
  if (message.payload) walk(message.payload, '0')

  const attachments = candidates.map((a) => ({
    ...a,
    is_inline: a.content_id !== null && html !== null &&
      html.includes(`cid:${a.content_id}`),
  }))

  const from = parseAddress(header(headers, 'From') ?? '')
  const replyTo = parseAddress(header(headers, 'Reply-To') ?? '')
  return {
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    rfc_message_id: stripAngles(header(headers, 'Message-ID')),
    in_reply_to: stripAngles(header(headers, 'In-Reply-To')),
    from_name: from?.name ?? null,
    from_address: from?.address ?? null,
    to: parseAddressList(header(headers, 'To')),
    cc: parseAddressList(header(headers, 'Cc')),
    bcc: parseAddressList(header(headers, 'Bcc')),
    reply_to_address: replyTo?.address ?? null,
    subject: header(headers, 'Subject'),
    snippet: message.snippet ?? null,
    sent_at: sentAt(message, now),
    label_ids: message.labelIds ?? [],
    body_html: html,
    body_text: text,
    size_estimate: message.sizeEstimate ?? null,
    attachments,
    body_refs: bodyRefs,
  }
}
