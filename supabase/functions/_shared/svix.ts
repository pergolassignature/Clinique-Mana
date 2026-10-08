/**
 * Svix webhook signature verification (Resend signs its webhooks with Svix).
 * Ported from PS Hub `_shared/svix-webhook.ts`; Web Crypto only, no `svix`
 * dependency.
 *
 * Scheme (docs.svix.com « Verifying webhooks manually »):
 * - headers `svix-id`, `svix-timestamp` (Unix seconds), `svix-signature`;
 * - HMAC-SHA256 of `${id}.${timestamp}.${rawBody}`, keyed with the base64
 *   bytes of the secret after `whsec_`;
 * - `svix-signature` lists space-separated `v1,<base64>` entries (several
 *   during a secret rotation): any one may match;
 * - the timestamp must be within the tolerance of now, to stop replays.
 */
import { timingSafeEqualBytes } from './timing-safe-equal.ts'

/** The raw request body and the three Svix headers, as received. */
export interface SvixInput {
  /** The body exactly as received: verify before parsing. */
  rawBody: string
  /** `svix-id` */
  id: string | null
  /** `svix-timestamp` */
  timestamp: string | null
  /** `svix-signature` */
  signature: string | null
  /** `whsec_<base64>`, or the bare base64. */
  secret: string
  /** Defaults to the current time. */
  nowSeconds?: number
  /** Defaults to 300 (Svix's own window). */
  toleranceSeconds?: number
}

const SECRET_PREFIX = 'whsec_'
const DEFAULT_TOLERANCE_SECONDS = 300

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** The `v1` signatures of a `svix-signature` header, decoded; others are ignored. */
function v1Signatures(header: string): Uint8Array[] {
  const out: Uint8Array[] = []
  for (const entry of header.split(' ')) {
    const comma = entry.indexOf(',')
    if (comma < 0 || entry.slice(0, comma) !== 'v1') continue
    const bytes = decodeBase64(entry.slice(comma + 1))
    if (bytes?.length) out.push(bytes)
  }
  return out
}

/**
 * True when one `v1` signature of `svix-signature` is the HMAC of the message
 * and the timestamp is within tolerance. Fails closed: a missing header, an
 * empty or undecodable secret, or a malformed timestamp gives false.
 */
export async function verifySvix(input: SvixInput): Promise<boolean> {
  const {
    rawBody,
    id,
    timestamp,
    signature,
    secret,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  } = input
  if (!id || !timestamp || !signature || !secret) return false

  if (!/^\d{1,15}$/.test(timestamp)) return false
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false

  const candidates = v1Signatures(signature)
  if (candidates.length === 0) return false

  const key = decodeBase64(
    secret.startsWith(SECRET_PREFIX)
      ? secret.slice(SECRET_PREFIX.length)
      : secret,
  )
  if (!key?.length) return false

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      hmacKey,
      new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
    ),
  )
  return candidates.some((candidate) =>
    timingSafeEqualBytes(expected, candidate)
  )
}
