import { assertEquals } from '@std/assert'
import {
  GOOGLE_CERTS_PATH,
  resetGoogleCertsCache,
  verifyGoogleIdToken,
} from './google-oidc.ts'
import { createOidcSigner, pushClaims } from './testing/google-oidc-signer.ts'

const ORIGIN = 'http://fake-certs.test'
const AUD = 'clinique-mana:gmail-push:00000000-0000-4000-8000-000000000001'
const EMAIL = 'gmail-push@mana-prod.iam.gserviceaccount.com'
const NOW = new Date('2026-10-12T15:00:00.000Z')
const nowS = NOW.getTime() / 1000

async function setup() {
  resetGoogleCertsCache()
  const signer = await createOidcSigner()
  const calls: string[] = []
  let jwks = await signer.jwks()
  const fetchFn = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push(url)
    if (url === `${ORIGIN}${GOOGLE_CERTS_PATH}`) {
      return Promise.resolve(
        Response.json(jwks, {
          headers: { 'Cache-Control': 'public, max-age=20000' },
        }),
      )
    }
    return Promise.resolve(new Response('nope', { status: 404 }))
  }) as typeof fetch
  const ctx = { fetch: fetchFn, certsOrigin: ORIGIN, now: () => NOW }
  return {
    signer,
    calls,
    ctx,
    setJwks: (value: typeof jwks) => {
      jwks = value
    },
  }
}

const expect = { audience: AUD, email: EMAIL }

Deno.test('google-oidc: a token Pub/Sub would send for the clinic passes; the keys are read once', async () => {
  const s = await setup()
  const token = await s.signer.sign(pushClaims(AUD, EMAIL, nowS))
  assertEquals(await verifyGoogleIdToken(token, expect, s.ctx), { ok: true })
  assertEquals(
    await verifyGoogleIdToken(token, {
      audience: AUD,
      email: ` ${EMAIL.toUpperCase()} `,
    }, s.ctx),
    { ok: true },
  )
  assertEquals(s.calls.length, 1, 'cached for max-age')
})

Deno.test('google-oidc: each claim is checked', async () => {
  const s = await setup()
  const check = async (claims: Record<string, unknown>) =>
    await verifyGoogleIdToken(await s.signer.sign(claims), expect, s.ctx)
  const base = pushClaims(AUD, EMAIL, nowS)
  assertEquals(await check({ ...base, aud: 'other' }), {
    ok: false,
    reason: 'audience',
  })
  assertEquals(await check({ ...base, aud: ['x', AUD] }), { ok: true })
  assertEquals(await check({ ...base, iss: 'https://evil.test' }), {
    ok: false,
    reason: 'issuer',
  })
  assertEquals(await check({ ...base, exp: nowS - 120 }), {
    ok: false,
    reason: 'expired',
  })
  assertEquals(await check({ ...base, iat: nowS + 600 }), {
    ok: false,
    reason: 'expired',
  })
  assertEquals(
    await check({ ...base, email: 'someone@else.iam.gserviceaccount.com' }),
    { ok: false, reason: 'email' },
  )
  assertEquals(await check({ ...base, email_verified: false }), {
    ok: false,
    reason: 'email',
  })
})

Deno.test('google-oidc: a forged or malformed token, another key, an unknown key or no keys are refused', async () => {
  const s = await setup()
  const good = await s.signer.sign(pushClaims(AUD, EMAIL, nowS))
  const [h, p] = good.split('.')
  const other = await createOidcSigner('fake-key-1')
  const forged = await other.sign(pushClaims(AUD, EMAIL, nowS))
  assertEquals(await verifyGoogleIdToken(forged, expect, s.ctx), {
    ok: false,
    reason: 'signature',
  })
  assertEquals(await verifyGoogleIdToken(`${h}.${p}.AAAA`, expect, s.ctx), {
    ok: false,
    reason: 'signature',
  })
  for (const bad of ['', 'a.b', 'a.b.c.d', 'é.é.é', 'x'.repeat(9_000)]) {
    assertEquals(await verifyGoogleIdToken(bad, expect, s.ctx), {
      ok: false,
      reason: 'malformed',
    })
  }
  const none = await s.signer.sign(pushClaims(AUD, EMAIL, nowS), {
    alg: 'none',
  })
  assertEquals((await verifyGoogleIdToken(none, expect, s.ctx)).ok, false)

  const unknown = await s.signer.sign(pushClaims(AUD, EMAIL, nowS), {
    kid: 'rotated-away',
  })
  const before = s.calls.length
  assertEquals(await verifyGoogleIdToken(unknown, expect, s.ctx), {
    ok: false,
    reason: 'unknown_key',
  })
  assertEquals(s.calls.length, before + 1, 'read again once for a new kid')

  resetGoogleCertsCache()
  const down = {
    ...s.ctx,
    fetch: (() => Promise.reject(new TypeError('down'))) as typeof fetch,
  }
  assertEquals(await verifyGoogleIdToken(good, expect, down), {
    ok: false,
    reason: 'certs_unavailable',
  })
})

Deno.test('google-oidc: a rotated key is found by reading the keys again', async () => {
  const s = await setup()
  const token = await s.signer.sign(pushClaims(AUD, EMAIL, nowS))
  assertEquals((await verifyGoogleIdToken(token, expect, s.ctx)).ok, true)
  const next = await createOidcSigner('fake-key-2')
  s.setJwks(await next.jwks())
  const rotated = await next.sign(pushClaims(AUD, EMAIL, nowS))
  assertEquals(await verifyGoogleIdToken(rotated, expect, s.ctx), { ok: true })
})
