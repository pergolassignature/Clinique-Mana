/**
 * Zoom's event notifications (RZ: the « app deauthorized » event). Zoom
 * signs each request with the app's « Secret Token »:
 *
 *   x-zm-signature: v0=<hex HMAC-SHA256(secret, `v0:<timestamp>:<raw body>`)>
 *   x-zm-request-timestamp: <unix seconds>
 *
 * `verifyZoomSignature` checks both (constant time; the timestamp within 5
 * minutes of now, so a captured request cannot be replayed later). When the
 * endpoint is saved in Zoom's app settings, Zoom first posts an
 * `endpoint.url_validation` event (signed the same way): the answer is the
 * plain token and its HMAC (`urlValidationAnswer`).
 */
import { timingSafeEqualBytes } from '../timing-safe-equal.ts'

const encoder = new TextEncoder()
/** How far the request's timestamp may be from now, in seconds. */
export const SIGNATURE_TOLERANCE_S = 300
const SIGNATURE = /^v0=([0-9a-f]{64})$/

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(message)),
  )
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Whether the request is Zoom's, signed with `secret`, and recent. */
export async function verifyZoomSignature(
  secret: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
  now: Date,
): Promise<boolean> {
  const match = signature === null ? null : SIGNATURE.exec(signature)
  if (!match || timestamp === null || !/^[0-9]{1,12}$/.test(timestamp)) {
    return false
  }
  const age = Math.floor(now.getTime() / 1000) - Number(timestamp)
  if (!(Math.abs(age) <= SIGNATURE_TOLERANCE_S)) return false
  const expected = await hmacHex(secret, `v0:${timestamp}:${rawBody}`)
  return timingSafeEqualBytes(
    encoder.encode(expected),
    encoder.encode(match[1]),
  )
}

/** The answer to `endpoint.url_validation`. */
export async function urlValidationAnswer(
  secret: string,
  plainToken: string,
): Promise<{ plainToken: string; encryptedToken: string }> {
  return { plainToken, encryptedToken: await hmacHex(secret, plainToken) }
}
