/**
 * Google-signed OIDC ID tokens: how a Pub/Sub push subscription with
 * authentication proves who sent it (CM-4). Pub/Sub puts
 * `Authorization: Bearer <JWT>` on each push, signed RS256 by Google, for the
 * service account the subscription names, with the audience the
 * subscription sets. `verifyGoogleIdToken` checks, in order: the shape and
 * `alg: RS256`; the signature with Google's published keys (`/oauth2/v3/certs`,
 * kept for the answer's `max-age`, read again once when a `kid` is unknown:
 * Google rotates them); the issuer; the audience; the expiry and issue time
 * (60 s of skew); the `email` (case-insensitive) with `email_verified`.
 *
 * Anyone can obtain a Google-signed token for any audience with their own
 * service account: what makes the push the clinic's is the `email` check
 * against the service account the clinic configured. The token never reaches
 * a log: callers log the `reason` code only.
 */
import { z } from 'zod'

/** Google's keys, under the certs origin (`https://www.googleapis.com`, or the local fake). */
export const GOOGLE_CERTS_PATH = '/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const SKEW_S = 60
const CERTS_TIMEOUT_MS = 5_000
const MAX_TOKEN_CHARS = 8_192

export type OidcFailure =
  | 'malformed'
  | 'certs_unavailable'
  | 'unknown_key'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'email'

export type OidcResult = { ok: true } | { ok: false; reason: OidcFailure }

export interface OidcExpectation {
  /** The subscription's audience. */
  audience: string
  /** The service account the clinic configured. */
  email: string
}

export interface OidcContext {
  fetch: typeof fetch
  /** Where the keys are read (`gmailOrigins(env).certs`). */
  certsOrigin: string
  now: () => Date
}

const jwksSchema = z.object({
  keys: z.array(z.looseObject({
    kid: z.string().min(1),
    kty: z.string(),
    n: z.string().optional(),
    e: z.string().optional(),
  })).max(20),
})

const headerSchema = z.looseObject({
  alg: z.literal('RS256'),
  kid: z.string().min(1).max(200),
})

const claimsSchema = z.looseObject({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
})

interface KeyCache {
  origin: string
  keys: Map<string, CryptoKey>
  expiresAt: number
}
let cache: KeyCache | null = null

/** Test-only: forgets the keys read (each test starts cold). */
export function resetGoogleCertsCache(): void {
  cache = null
}

function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

const base64UrlJson = (text: string): unknown =>
  JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(base64UrlBytes(text)),
  )

async function readKeys(
  ctx: OidcContext,
  fresh: boolean,
): Promise<Map<string, CryptoKey>> {
  const now = ctx.now().getTime()
  if (
    !fresh && cache && cache.origin === ctx.certsOrigin && cache.expiresAt > now
  ) {
    return cache.keys
  }
  const res = await ctx.fetch(`${ctx.certsOrigin}${GOOGLE_CERTS_PATH}`, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(CERTS_TIMEOUT_MS),
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error('certs_unavailable')
  }
  const body = jwksSchema.parse(await res.json())
  const keys = new Map<string, CryptoKey>()
  for (const key of body.keys) {
    if (key.kty !== 'RSA' || !key.n || !key.e) continue
    keys.set(
      key.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    )
  }
  const maxAge = Number(
    /max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ??
      3_600,
  )
  cache = {
    origin: ctx.certsOrigin,
    keys,
    expiresAt: now + Math.min(Math.max(maxAge, 60), 86_400) * 1000,
  }
  return keys
}

/** The key of `kid`, reading Google's keys again once when it is unknown (a rotation). */
async function keyFor(
  ctx: OidcContext,
  kid: string,
): Promise<CryptoKey | null | 'unavailable'> {
  try {
    const known = (await readKeys(ctx, false)).get(kid)
    if (known) return known
    return (await readKeys(ctx, true)).get(kid) ?? null
  } catch {
    return 'unavailable'
  }
}

/** Checks a push's bearer token; see the module comment. Never throws. */
export async function verifyGoogleIdToken(
  token: string,
  expect: OidcExpectation,
  ctx: OidcContext,
): Promise<OidcResult> {
  const fail = (reason: OidcFailure): OidcResult => ({ ok: false, reason })
  if (token.length > MAX_TOKEN_CHARS) return fail('malformed')
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
    return fail('malformed')
  }
  let header: z.infer<typeof headerSchema>
  let claims: z.infer<typeof claimsSchema>
  try {
    const h = headerSchema.safeParse(base64UrlJson(parts[0]))
    const c = claimsSchema.safeParse(base64UrlJson(parts[1]))
    if (!h.success || !c.success) return fail('malformed')
    header = h.data
    claims = c.data
  } catch {
    return fail('malformed')
  }
  const key = await keyFor(ctx, header.kid)
  if (key === 'unavailable') return fail('certs_unavailable')
  if (key === null) return fail('unknown_key')
  let valid = false
  try {
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
  } catch {
    valid = false
  }
  if (!valid) return fail('signature')
  if (!ISSUERS.has(claims.iss)) return fail('issuer')
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(expect.audience)) return fail('audience')
  const now = ctx.now().getTime() / 1000
  if (claims.exp < now - SKEW_S || claims.iat > now + SKEW_S) {
    return fail('expired')
  }
  if (
    claims.email_verified !== true || !claims.email ||
    claims.email.toLowerCase() !== expect.email.trim().toLowerCase()
  ) {
    return fail('email')
  }
  return { ok: true }
}
