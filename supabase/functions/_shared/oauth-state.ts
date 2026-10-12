/**
 * OAuth `state` for the integrations that connect an account (Gmail now;
 * Zoom, QuickBooks and the Google busy/free later, plan §13): a signed,
 * short-lived, single-use ticket, so a callback is only ever accepted for the
 * person and clinic that started the flow (PS Hub's unsigned base64 state
 * let anyone craft one, roadmap §2.4 bis).
 *
 * - `signState` builds `<payload>.<mac>`: the payload is base64url JSON
 *   `{ v: 1, p: purpose, o: org, u: user, n: nonce, e: expiry (unix s),
 *   d?: data }`, the MAC an HMAC-SHA256 over the payload bytes keyed with
 *   `INTERNAL_FUNCTION_SECRET` (the key every function already holds).
 * - `verifyState` checks the format, the MAC (constant time), the expiry (10
 *   minutes) and the purpose, and answers the payload. Who may use it is the
 *   caller's check: the callback compares `org` and `user` with the signed-in
 *   caller. Single use is the caller's too: it spends the nonce on a
 *   rate-limit bucket of one hit (`LIMITS.oauthStateNonce`), so a replayed
 *   state is refused like a second click.
 * - The state never carries a secret or a return address: the app's return
 *   path is fixed (no open redirect).
 */
import { timingSafeEqualBytes } from './timing-safe-equal.ts'
import { UUID } from './patterns.ts'

/** How long a state stays valid, in seconds. */
export const STATE_TTL_S = 600

/** What a state carries. */
export interface OAuthState {
  purpose: string
  orgId: string
  userId: string
  nonce: string
  /** Unix seconds. */
  expiresAt: number
  /** Small, non-secret extra data (a mailbox kind). */
  data?: Record<string, string>
}

/** Why a state is refused. */
export type StateRefusal =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'wrong_purpose'

const encoder = new TextEncoder()
const PURPOSE = /^[a-z][a-z0-9_]{1,40}$/
const B64URL = /^[A-Za-z0-9_-]+$/

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(
    /=+$/,
    '',
  )
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!B64URL.test(text)) return null
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') +
    '='.repeat((4 - text.length % 4) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

async function mac(secret: string, payload: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, payload as BufferSource),
  )
}

/** A signed state for `purpose`, valid `STATE_TTL_S` from `now`. */
export async function signState(
  secret: string,
  input: Omit<OAuthState, 'nonce' | 'expiresAt'>,
  now: Date,
): Promise<{ state: string; nonce: string }> {
  if (!PURPOSE.test(input.purpose)) throw new TypeError('bad purpose')
  const nonce = crypto.randomUUID()
  const payload = encoder.encode(JSON.stringify({
    v: 1,
    p: input.purpose,
    o: input.orgId,
    u: input.userId,
    n: nonce,
    e: Math.floor(now.getTime() / 1000) + STATE_TTL_S,
    ...(input.data ? { d: input.data } : {}),
  }))
  const signature = await mac(secret, payload)
  return { state: `${base64Url(payload)}.${base64Url(signature)}`, nonce }
}

/**
 * The payload of a valid state for `purpose`, or the refusal. The MAC is
 * checked before the payload is read, so a forged state reveals nothing.
 */
export async function verifyState(
  secret: string,
  state: string,
  purpose: string,
  now: Date,
): Promise<
  { ok: true; state: OAuthState } | { ok: false; reason: StateRefusal }
> {
  if (typeof state !== 'string' || state.length > 2_048) {
    return { ok: false, reason: 'malformed' }
  }
  const dot = state.indexOf('.')
  if (dot <= 0 || dot === state.length - 1) {
    return { ok: false, reason: 'malformed' }
  }
  const payload = fromBase64Url(state.slice(0, dot))
  const signature = fromBase64Url(state.slice(dot + 1))
  if (!payload || !signature || signature.length !== 32) {
    return { ok: false, reason: 'malformed' }
  }
  const expected = await mac(secret, payload)
  if (!timingSafeEqualBytes(expected, signature)) {
    return { ok: false, reason: 'bad_signature' }
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(payload),
    )
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const { v, p, o, u, n, e, d } = parsed
  if (
    v !== 1 || typeof p !== 'string' || typeof o !== 'string' ||
    typeof u !== 'string' || typeof n !== 'string' ||
    typeof e !== 'number' || !UUID.test(o) || !UUID.test(u) || !UUID.test(n) ||
    (d !== undefined && (typeof d !== 'object' || d === null ||
      Array.isArray(d) ||
      !Object.values(d).every((value) => typeof value === 'string')))
  ) {
    return { ok: false, reason: 'malformed' }
  }
  if (p !== purpose) return { ok: false, reason: 'wrong_purpose' }
  if (e <= Math.floor(now.getTime() / 1000)) {
    return { ok: false, reason: 'expired' }
  }
  return {
    ok: true,
    state: {
      purpose: p,
      orgId: o,
      userId: u,
      nonce: n,
      expiresAt: e,
      ...(d ? { data: d as Record<string, string> } : {}),
    },
  }
}
