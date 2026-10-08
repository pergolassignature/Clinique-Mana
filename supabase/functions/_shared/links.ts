/**
 * Secure link tokens (design §3, P3-7): generation, hashing and URLs.
 *
 * - A token is 32 bytes from `crypto.getRandomValues`, base64url without
 *   padding (43 characters). It exists only in the function's memory and in
 *   the email: it is never stored, logged, reported or returned to staff.
 * - The database stores only the token's hash (`secure_links.token_hash
 *   bytea`, 32 bytes, Task 3.17): SHA-256 over the UTF-8 bytes of the
 *   43-character token string, not over the 32 decoded random bytes. A link
 *   is looked up by that hash. There is no comparison of secrets in code, so
 *   no timing oracle: an attacker would have to guess a 256-bit value.
 * - The link carries the token in the URL **fragment** (`#t=`), which
 *   browsers never send to *our* server, so it stays out of our access logs
 *   and the `Referer` header. Link rewriters in mail clients (Outlook Safe
 *   Links, scanners) may still copy the whole URL, fragment included: the
 *   fragment limits where the token travels, it does not keep it secret.
 *
 * Callers (public token functions, CLAUDE.md §7) check `isWellFormedToken`
 * first, and answer a malformed token exactly like an unknown one.
 */
import { byteaHex } from './bytea.ts'
import { FunctionError } from './errors.ts'

/** Random bytes per token: 256 bits. */
const TOKEN_BYTES = 32

/**
 * Exactly 43 base64url characters whose last one encodes only zero padding
 * bits (43 × 6 = 258 bits for 256), so each token has one spelling.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

/** Paths the app serves a link page on. */
const LINK_PATHS: ReadonlySet<string> = new Set(['/invitation'])

/** The only plain-http app origin accepted: the local Vite server. */
const LOCAL_DEV_ORIGIN = 'http://localhost:5173'

/** A path the app serves a link page on (the page reads `#t=`). */
export type LinkPath = '/invitation'

/** Base64url of `bytes`, without padding (RFC 4648 §5). */
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/**
 * A new link token: 32 random bytes, base64url without padding (43 chars).
 * Exists only in memory and in the email: never log, store or return it.
 */
export function generateToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
}

/**
 * True only for a canonical 43-character base64url token, as made by
 * `generateToken`. Anything else (another type, length or character, padding,
 * standard base64, surrounding whitespace) is refused before any hashing or
 * lookup.
 */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

/**
 * SHA-256 of the token string's UTF-8 bytes (not of the decoded base64url
 * bytes), as the `\x…` hex literal (64 lowercase hex digits) that PostgREST
 * accepts for a `bytea` argument such as `p_token_hash`.
 *
 * @throws TypeError when `token` is not well formed (the message never holds
 *   the value). Check `isWellFormedToken` first.
 */
export async function hashToken(token: string): Promise<string> {
  if (!isWellFormedToken(token)) {
    throw new TypeError('hashToken: malformed token')
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return byteaHex(new Uint8Array(digest))
}

/**
 * The app origin of `appUrl`: a bare `https://` origin (an optional trailing
 * slash is allowed), or exactly `http://localhost:5173` for local
 * development. No path, query, fragment or credentials.
 */
function appOrigin(appUrl: string): string | null {
  let url: URL
  try {
    url = new URL(appUrl)
  } catch {
    return null
  }
  const bare = url.pathname === '/' && !url.search && !url.hash &&
    !appUrl.includes('?') && !appUrl.includes('#') && !url.username &&
    !url.password
  if (!bare) return null
  if (url.protocol === 'https:') return url.origin
  return url.origin === LOCAL_DEV_ORIGIN ? url.origin : null
}

/**
 * `${appUrl}${path}#t=${token}`. The token travels in the fragment, which is
 * never sent to the server; the page reads it, then removes it.
 *
 * @param appUrl the `APP_URL` secret: a bare https origin, or
 *   `http://localhost:5173` locally.
 * @throws FunctionError `server_misconfigured` when `appUrl` is not accepted
 *   (the caller answers 500).
 * @throws TypeError when `path` is not a link page or `token` is not well
 *   formed (the message never holds the token).
 */
export function linkUrl(appUrl: string, path: LinkPath, token: string): string {
  if (!LINK_PATHS.has(path)) {
    throw new TypeError('linkUrl: unknown link path')
  }
  if (!isWellFormedToken(token)) {
    throw new TypeError('linkUrl: malformed token')
  }
  const origin = appOrigin(appUrl)
  if (!origin) {
    throw new FunctionError(
      'server_misconfigured',
      `APP_URL must be an https origin (or ${LOCAL_DEV_ORIGIN} locally)`,
    )
  }
  return `${origin}${path}#t=${token}`
}
