/**
 * Rate limits for edge functions, enforced by `public.consume_rate_limit`
 * (service role only, fixed windows; Task 3.2).
 *
 * Keys are HMAC-hashed here, so no raw IP, address or id reaches the database.
 * The HMAC key is derived from `INTERNAL_FUNCTION_SECRET`. Every failure (no
 * secret, an RPC error, an unexpected result) fails **closed** and is reported,
 * with `reason: 'unavailable'`: answer it 503 `not_configured`, not 429.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { errorResponse } from './auth.ts'
import { byteaHex } from './bytea.ts'
import { reportError } from './report.ts'

/** A bucket and its starting limit: at most `max` hits per `windowSeconds`. */
export interface RateLimit {
  bucket: string
  max: number
  windowSeconds: number
}

/**
 * Starting values (design §2.6 and §3.2, P3-18), in one place. The 80 % warning
 * on `emails.org_day` belongs to the send path (Task 3.8).
 */
export const LIMITS = {
  /** « M'envoyer un test », per caller. */
  emailTest: { bucket: 'emails.test', max: 10, windowSeconds: 3_600 },
  /** Every send, per org: a runaway-loop brake. */
  emailOrgDay: { bucket: 'emails.org_day', max: 500, windowSeconds: 86_400 },
  /** Same template to the same address, unless « Renvoyer ». */
  emailSameAddress: {
    bucket: 'emails.same_address',
    max: 1,
    windowSeconds: 60,
  },
  /**
   * « Renvoyer » and « M'envoyer un test » skip `emailSameAddress`; this
   * guard keeps a double click from sending twice: one per 5 s window per
   * template, address and sender (a fixed window, so two clicks straddling
   * its edge can both pass).
   */
  emailRepeatGuard: { bucket: 'emails.repeat_guard', max: 1, windowSeconds: 5 },
  /** Typed (free) recipients, per sender (P3-18). */
  emailFreeRecipient: {
    bucket: 'emails.free_recipient',
    max: 20,
    windowSeconds: 3_600,
  },
  /** `resolve-link`, per IP. */
  linkResolveIp: { bucket: 'links.resolve_ip', max: 30, windowSeconds: 600 },
  /** `accept-invite`, per IP. */
  inviteAcceptIp: { bucket: 'links.accept_ip', max: 10, windowSeconds: 3_600 },
  /** `accept-invite`, per link. */
  inviteAcceptLink: {
    bucket: 'links.accept_link',
    max: 5,
    windowSeconds: 3_600,
  },
  /**
   * `staff-invite` (invite and « Renvoyer »), per caller: each call issues a
   * link and sends an email, on top of the email limits.
   */
  staffInviteUser: {
    bucket: 'invites.staff_user',
    max: 30,
    windowSeconds: 3_600,
  },
  /**
   * `storage-upload`, per caller: each call creates a pending row and signs
   * an upload of up to the purpose's size cap.
   */
  storageUploadUser: {
    bucket: 'storage.upload_user',
    max: 60,
    windowSeconds: 3_600,
  },
  /**
   * `storage-confirm`, per caller: each call may download and hash an object
   * of up to the purpose's size cap. Retries after a lost answer count too.
   */
  storageConfirmUser: {
    bucket: 'storage.confirm_user',
    max: 120,
    windowSeconds: 3_600,
  },
  /**
   * `storage-sign`, per caller: each call mints a 5-minute read URL. A page
   * of previews signs one per file (the client caches each for 4 minutes).
   */
  storageSignUser: {
    bucket: 'storage.sign_user',
    max: 120,
    windowSeconds: 3_600,
  },
  /**
   * `signing-sync` (« Synchroniser »), per caller: each call reads the
   * document from Documenso and may download the signed PDF.
   */
  signingSyncUser: {
    bucket: 'signing.sync_user',
    max: 60,
    windowSeconds: 3_600,
  },
  /** `signing-test-connection`, per caller: one Documenso read each. */
  signingTestConnectionUser: {
    bucket: 'signing.test_connection_user',
    max: 30,
    windowSeconds: 3_600,
  },
  /**
   * `signing-test-document`, per caller: each call renders a PDF and has
   * Documenso email the caller.
   */
  signingTestDocumentUser: {
    bucket: 'signing.test_document_user',
    max: 10,
    windowSeconds: 3_600,
  },
} as const satisfies Record<string, RateLimit>

/**
 * The outcome of one hit; `retryAfter` is in seconds (0 when allowed).
 * `reason: 'unavailable'` means the limiter itself failed (closed): the caller
 * answers 503 `not_configured`, not 429 `rate_limited` (« Trop de tentatives »).
 */
export interface RateLimitResult {
  allowed: boolean
  hits: number
  retryAfter: number
  reason?: 'unavailable'
}

/** What a caller is told when the limiter itself fails (fail closed). */
const FAIL_CLOSED: RateLimitResult = {
  allowed: false,
  hits: 0,
  retryAfter: 60,
  reason: 'unavailable',
}

const encoder = new TextEncoder()
let derived: { secret: string; key: Promise<CryptoKey> } | null = null

function hmacKey(raw: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/** HMAC(secret, 'rate-limit-v1') as an HMAC key, cached for the last secret. */
function derivedKey(secret: string): Promise<CryptoKey> {
  if (derived?.secret !== secret) {
    const key = hmacKey(encoder.encode(secret))
      .then((k) =>
        crypto.subtle.sign('HMAC', k, encoder.encode('rate-limit-v1'))
      )
      .then(hmacKey)
    derived = { secret, key }
  }
  return derived.key
}

/** The 16-bit groups of an IPv6 address (8, or 6 + an IPv4 tail), or null. */
function ipv6Groups(ip: string): number[] | null {
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const parse = (half: string): number[] | null => {
    if (half === '') return []
    const groups: number[] = []
    for (const part of half.split(':')) {
      if (/^[0-9a-f]{1,4}$/i.test(part)) groups.push(parseInt(part, 16))
      else if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(part)) {
        const [a, b, c, d] = part.split('.').map(Number)
        if ([a, b, c, d].some((n) => n > 255)) return null
        groups.push((a << 8) | b, (c << 8) | d)
      } else return null
    }
    return groups
  }
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  if (!head || !tail) return null
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  return [...head, ...new Array(missing).fill(0), ...tail]
}

/**
 * The rate-limit key for an IP: IPv4 as is; IPv6 reduced to its /64 prefix
 * (`2001:db8:0:1::/64`), since one subscriber usually holds a whole /64 and
 * could otherwise rotate addresses within it; an IPv4-mapped IPv6
 * (`::ffff:203.0.113.5`) as its IPv4. Anything unparseable is kept as is.
 */
function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const groups = ipv6Groups(ip.replace(/^\[|\]$/g, '').replace(/%.*$/, ''))
  if (!groups) return ip
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255]
      .join('.')
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}

/** What an IP header value may hold: IPv4, IPv6 (brackets, zone `%`). */
const IP_FORMAT = /^[0-9a-fA-F:.[\]%]{2,64}$/

/**
 * The raw client IP from the header `CLIENT_IP_SOURCE` names, or null:
 * - `xff-rightmost` (default, also for an unknown value): the **rightmost**
 *   `x-forwarded-for` entry, the one the Supabase gateway appends. Entries to
 *   its left come from the client and can be forged, so they are ignored.
 * - `cf-connecting-ip`: that header only (a Cloudflare front that sets it);
 *   no fallback to `x-forwarded-for`.
 */
function rawClientIp(req: Request): string | null {
  if (Deno.env.get('CLIENT_IP_SOURCE') === 'cf-connecting-ip') {
    return req.headers.get('cf-connecting-ip')?.trim() || null
  }
  return req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || null
}

/**
 * The caller's IP as a rate-limit key: by default the rightmost
 * `x-forwarded-for` entry (`CLIENT_IP_SOURCE`, see `rawClientIp`), checked
 * against `IP_FORMAT`, with IPv6 grouped by /64 (see `ipKey`). A missing,
 * empty or malformed value gives `'unknown'`: such requests share one bucket
 * per limit. Verify on staging what the gateway appends (design §3.2).
 */
export function clientIp(req: Request): string {
  const ip = rawClientIp(req)
  return ip && IP_FORMAT.test(ip) ? ipKey(ip) : 'unknown'
}

/**
 * The 32-byte HMAC-SHA256 of `parts` (JSON-encoded, so `['a','b']` and
 * `['ab']` differ), keyed with `HMAC(secret, 'rate-limit-v1')`.
 */
export async function hashKey(
  parts: string[],
  secret: string,
): Promise<Uint8Array> {
  const key = await derivedKey(secret)
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(JSON.stringify(parts)),
  )
  return new Uint8Array(mac)
}

/**
 * Records one hit on `limit` for `keyParts` (e.g. `[clientIp(req)]` or
 * `[orgId, userId]`). Needs a service-role client. Fails closed with
 * `reason: 'unavailable'` (→ 503 `not_configured`); a plain refusal (→ 429
 * `rate_limited`) has no `reason`.
 */
export async function consume(
  client: SupabaseClient,
  limit: RateLimit,
  keyParts: string[],
): Promise<RateLimitResult> {
  const secret = Deno.env.get('INTERNAL_FUNCTION_SECRET')
  if (!secret) {
    await reportError({
      fn: 'rate-limit',
      code: 'not_configured',
      ids: { bucket: limit.bucket },
    })
    return { ...FAIL_CLOSED }
  }
  // Assumed signature (Task 3.2, DB lane to confirm):
  // consume_rate_limit(p_bucket text, p_key_hash bytea, p_max int, p_window_seconds int)
  //   returns table (allowed boolean, hits int, retry_after_seconds int)
  // → PostgREST answers an array with one row; bytea is sent as '\x<hex>'.
  const { data, error } = await client.rpc('consume_rate_limit', {
    p_bucket: limit.bucket,
    p_key_hash: byteaHex(await hashKey(keyParts, secret)),
    p_max: limit.max,
    p_window_seconds: limit.windowSeconds,
  })
  const row = Array.isArray(data) ? data[0] : null
  if (
    error || typeof row?.allowed !== 'boolean' ||
    typeof row.hits !== 'number' ||
    typeof row.retry_after_seconds !== 'number'
  ) {
    await reportError({
      fn: 'rate-limit',
      code: 'rate_limit_unavailable',
      ids: { bucket: limit.bucket },
    })
    return { ...FAIL_CLOSED }
  }
  return {
    allowed: row.allowed,
    hits: row.hits,
    retryAfter: row.retry_after_seconds,
  }
}

/**
 * The answer for a refused hit, or null when allowed: 429 `rate_limited`
 * with `Retry-After`, or 503 `not_configured` when the limiter itself failed.
 */
export function limitResponse(
  result: RateLimitResult,
  req?: Request,
): Response | null {
  if (result.allowed) return null
  if (result.reason === 'unavailable') {
    return errorResponse(
      'not_configured',
      'Rate limiting is unavailable',
      503,
      req,
    )
  }
  const res = errorResponse('rate_limited', 'Too many attempts', 429, req)
  res.headers.set('Retry-After', String(result.retryAfter))
  return res
}
