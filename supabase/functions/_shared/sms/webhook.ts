/**
 * What the PBX posts to `sms-webhook` (batch SM; PS Hub
 * `_shared/yeastar-webhook.ts`, the message part), dependency-free:
 *
 * - **Signature:** Yeastar signs the raw body with HMAC-SHA256 and the webhook
 *   secret set in Integrations → API, in `X-Signature` (base64; a `sha256=`
 *   prefix and a hex digest are accepted too). `verifyYeastarSignature`
 *   compares in constant time.
 * - **Envelope:** `{ type, sn, msg }`, `msg` an object or a JSON string.
 *   Message events are 30030 (a bulk send failed), 30031 (a message in a
 *   session: an inbound text from an external number, or the echo of our own
 *   send when `sender.user_type` is 1 or 9), 30032 (a delivery report for a
 *   text we sent: `delivery_status` 1 sent, 2 failed, with `send_error`).
 *   Other types are the PBX's call events: acked and ignored by the webhook.
 *
 * `normalizeMessageEvent` keeps what the RPCs take: ids, the direction, the
 * sender's number, the body, attachment names/types/sizes (never a URI),
 * the delivery outcome and the PBX's time. No logging anywhere here.
 */
import { timingSafeEqualBytes } from '../timing-safe-equal.ts'

export const MESSAGE_EVENT_TYPES = [30030, 30031, 30032] as const
export type MessageEventType = (typeof MESSAGE_EVENT_TYPES)[number]

/** The envelope, with `msg` parsed. */
export interface YeastarEnvelope {
  type: number | null
  sn: string | null
  /** `test` for the « Test » button of Integrations → API. */
  event: string | null
  msg: Record<string, unknown> | null
}

/** An attachment of an inbound MMS: what is kept (SM-12: the file itself is not downloaded). */
export interface MessageMedia {
  name: string | null
  type: string | null
  size: number | null
}

/** A message event, as the RPCs take it. */
export interface MessageEvent {
  type: MessageEventType
  /** `in`: a text from an external number; `out`: our own echo or delivery report; null for 30030. */
  direction: 'in' | 'out' | null
  sessionId: number | null
  msgId: number | null
  /** The sender's number, only for a genuine inbound text. */
  from: string | null
  body: string | null
  media: MessageMedia[]
  /** 1 sent, 2 failed (30032; the PBX may set it on 30031 too). */
  deliveryStatus: number | null
  /** The PBX's failure code (`invalid_phone_number`…), as a safe identifier. */
  sendError: string | null
  /** When the PBX received it, from `receive_time` / `send_time` (unix seconds). */
  at: Date | null
}

const encoder = new TextEncoder()

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * True when `header` is the HMAC-SHA256 of `rawBody` keyed with `secret`:
 * base64 (Yeastar's form) or 64 hex characters, with or without `sha256=`.
 */
export async function verifyYeastarSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false
  const provided = header.trim().replace(/^sha256=/i, '')
  if (provided === '' || provided.length > 128) return false
  const given = /^[0-9a-f]{64}$/i.test(provided)
    ? hexToBytes(provided)
    : base64ToBytes(provided)
  if (!given) return false
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)),
  )
  return timingSafeEqualBytes(expected, given)
}

/** The base64 HMAC-SHA256 of `rawBody`, as the PBX computes it (the fake and the tests sign with it). */
export async function signYeastarBody(
  rawBody: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)),
  )
  let binary = ''
  for (const byte of mac) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function integer(value: unknown): number | null {
  const n = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[0-9]{1,18}$/.test(value)
    ? Number(value)
    : NaN
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

/** The envelope of a raw body, or null when it is not one. */
export function parseYeastarEnvelope(rawBody: string): YeastarEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const type = integer(parsed.type)
  let msg: Record<string, unknown> | null = null
  if (isRecord(parsed.msg)) msg = parsed.msg
  else if (typeof parsed.msg === 'string' && parsed.msg.trim() !== '') {
    try {
      const inner = JSON.parse(parsed.msg)
      if (isRecord(inner)) msg = inner
    } catch {
      msg = null
    }
  }
  return { type, sn: text(parsed.sn), event: text(parsed.event), msg }
}

export function isMessageEvent(type: number | null): type is MessageEventType {
  return type !== null &&
    (MESSAGE_EVENT_TYPES as readonly number[]).includes(type)
}

/** `msg_files`: a JSON string or an array of File_Info; names, types and sizes only. */
function mediaOf(raw: unknown): MessageMedia[] {
  let source: unknown = raw
  if (typeof raw === 'string') {
    if (raw.trim() === '') return []
    try {
      source = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(source)) return []
  return source.slice(0, 10).map((item) => {
    const file = isRecord(item) ? item : {}
    return {
      name: text(file.name)?.slice(0, 200) ?? null,
      type: text(file.type)?.slice(0, 100) ?? null,
      size: integer(file.size),
    }
  })
}

/** A safe code from the PBX's `send_error`, or null. */
function errorCode(value: unknown): string | null {
  const code = text(value)?.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(
    /^_+|_+$/g,
    '',
  )
  return code && code.length <= 64 ? code : null
}

function unixSeconds(value: unknown): Date | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null
}

/**
 * The message event of an envelope (type 30030, 30031 or 30032). On a 30031
 * the direction comes from the sender: `user_type` 1 (an extension) or 9
 * (the API platform, us) is our own echo, anything else an external number;
 * the number is kept only for a genuine inbound.
 */
export function normalizeMessageEvent(
  envelope: YeastarEnvelope,
): MessageEvent | null {
  if (!isMessageEvent(envelope.type)) return null
  const msg = envelope.msg ?? {}
  const sender = isRecord(msg.sender) ? msg.sender : null
  let direction: MessageEvent['direction'] = null
  if (envelope.type === 30032) direction = 'out'
  else if (envelope.type === 30031) {
    const userType = integer(sender?.user_type)
    direction = userType === 1 || userType === 9 ? 'out' : 'in'
  }
  return {
    type: envelope.type,
    direction,
    sessionId: integer(msg.session_id),
    msgId: integer(msg.msg_id),
    from: envelope.type === 30031 && direction === 'in'
      ? text(sender?.user_no)
      : null,
    body: typeof msg.msg_body === 'string' && msg.msg_body !== ''
      ? msg.msg_body
      : null,
    media: mediaOf(msg.msg_files),
    deliveryStatus: integer(msg.delivery_status),
    sendError: errorCode(msg.send_error),
    at: unixSeconds(msg.receive_time) ?? unixSeconds(msg.send_time),
  }
}
