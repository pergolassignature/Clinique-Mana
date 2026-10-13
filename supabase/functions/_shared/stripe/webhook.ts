/**
 * Stripe's webhook signature (`Stripe-Signature: t=…,v1=…`): HMAC-SHA256 of
 * `${t}.${raw body}` with the endpoint's secret (`whsec_…`), compared in
 * constant time with every `v1`; the timestamp within 5 minutes of now (a
 * replay is refused). `signStripePayload` is the same signature, for the fake
 * and the tests.
 */
import { timingSafeEqual } from '../timing-safe-equal.ts'

/** Seconds a signed event stays acceptable. */
export const TOLERANCE_SECONDS = 300

const encoder = new TextEncoder()

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(payload)),
  )
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The `Stripe-Signature` header for `payload` at `timestamp` (seconds). */
export async function signStripePayload(
  secret: string,
  payload: string,
  timestamp: number,
): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${payload}`)}`
}

/** Whether `header` signs `payload` with `secret`, at most TOLERANCE_SECONDS from `nowSeconds`. */
export async function verifyStripeSignature(
  header: string | null,
  payload: string,
  secret: string,
  nowSeconds: number,
): Promise<boolean> {
  if (!header || !secret) return false
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2)
    if (key?.trim() === 't' && value && /^[0-9]{1,12}$/.test(value.trim())) {
      timestamp = Number(value.trim())
    } else if (
      key?.trim() === 'v1' && value && /^[0-9a-f]{64}$/.test(value.trim())
    ) signatures.push(value.trim())
  }
  if (timestamp === null || signatures.length === 0 || signatures.length > 8) {
    return false
  }
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false
  const expected = await hmacHex(secret, `${timestamp}.${payload}`)
  let ok = false
  for (const signature of signatures) {
    if (timingSafeEqual(expected, signature)) ok = true
  }
  return ok
}
