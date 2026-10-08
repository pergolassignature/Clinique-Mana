import { assert, assertFalse } from '@std/assert'
import { type SvixInput, verifySvix } from './svix.ts'

// ---------------------------------------------------------------------------
// Published vectors (Svix « Verifying webhooks manually »). Both were also
// checked against Node's `crypto.createHmac`.
// ---------------------------------------------------------------------------
Deno.test('verifySvix: Svix published vector (2021)', async () => {
  assert(
    await verifySvix({
      rawBody: '{"test": 2432232314}',
      id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      timestamp: '1614265330',
      signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
      secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      nowSeconds: 1614265330,
    }),
  )
})

Deno.test('verifySvix: Svix published vector (current docs)', async () => {
  assert(
    await verifySvix({
      rawBody: '{"event_type":"ping","data":{"success":true}}',
      id: 'msg_loFOjxBNrRLzqYUf',
      timestamp: '1731705121',
      signature: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
      secret: 'whsec_plJ3nmyCDGBKInavdOK15jsl',
      nowSeconds: 1731705121,
    }),
  )
})

// ---------------------------------------------------------------------------
// Generated signatures over a random secret (as in PS Hub's test).
// ---------------------------------------------------------------------------
const ID = 'msg_2xT0test'
const TS = 2_000_000_000
const BODY = JSON.stringify({
  type: 'email.delivered',
  data: { email_id: 'e1' },
})
const KEY = crypto.getRandomValues(new Uint8Array(24))
const OTHER_KEY = crypto.getRandomValues(new Uint8Array(24))
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const SECRET = `whsec_${b64(KEY)}`

async function sign(
  key: Uint8Array<ArrayBuffer>,
  body = BODY,
  id = ID,
  ts = String(TS),
): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    k,
    new TextEncoder().encode(`${id}.${ts}.${body}`),
  )
  return `v1,${b64(new Uint8Array(mac))}`
}

async function input(overrides: Partial<SvixInput> = {}): Promise<SvixInput> {
  return {
    rawBody: BODY,
    id: ID,
    timestamp: String(TS),
    signature: await sign(KEY),
    secret: SECRET,
    nowSeconds: TS,
    ...overrides,
  }
}

Deno.test('verifySvix: a valid signature over the raw body', async () => {
  assert(await verifySvix(await input()))
})

Deno.test('verifySvix: a secret without the whsec_ prefix still verifies', async () => {
  assert(await verifySvix(await input({ secret: b64(KEY) })))
})

Deno.test('verifySvix: tolerance is ±300 s inclusive', async () => {
  assert(await verifySvix(await input({ nowSeconds: TS + 300 })))
  assert(await verifySvix(await input({ nowSeconds: TS - 300 })))
  assertFalse(await verifySvix(await input({ nowSeconds: TS + 301 })))
  assertFalse(await verifySvix(await input({ nowSeconds: TS - 301 })))
})

Deno.test('verifySvix: a custom tolerance applies', async () => {
  const late = { nowSeconds: TS + 60 }
  assert(await verifySvix(await input({ ...late, toleranceSeconds: 60 })))
  assertFalse(await verifySvix(await input({ ...late, toleranceSeconds: 59 })))
})

Deno.test('verifySvix: defaults to the current time', async () => {
  const now = String(Math.floor(Date.now() / 1000))
  const fresh = {
    timestamp: now,
    signature: await sign(KEY, BODY, ID, now),
    nowSeconds: undefined,
  }
  assert(await verifySvix(await input(fresh)))
  // A fixed timestamp from 2021: outside the window from any later today.
  const stale = '1614265330'
  assertFalse(
    await verifySvix(
      await input({
        timestamp: stale,
        signature: await sign(KEY, BODY, ID, stale),
        nowSeconds: undefined,
      }),
    ),
  )
})

Deno.test('verifySvix: a tampered body, id or timestamp fails', async () => {
  assertFalse(await verifySvix(await input({ rawBody: `${BODY} ` })))
  assertFalse(await verifySvix(await input({ id: 'msg_other' })))
  assertFalse(await verifySvix(await input({ timestamp: String(TS + 1) })))
})

Deno.test('verifySvix: a signature from another secret fails', async () => {
  assertFalse(
    await verifySvix(await input({ signature: await sign(OTHER_KEY) })),
  )
  assertFalse(
    await verifySvix(await input({ secret: `whsec_${b64(OTHER_KEY)}` })),
  )
})

Deno.test('verifySvix: any one of several signatures may match', async () => {
  const good = await sign(KEY)
  const bad = await sign(OTHER_KEY)
  assert(await verifySvix(await input({ signature: `${bad} ${good}` })))
  assert(await verifySvix(await input({ signature: `${good} ${bad}` })))
  // Extra whitespace between entries is tolerated.
  assert(await verifySvix(await input({ signature: `  ${bad}   ${good} ` })))
  assertFalse(await verifySvix(await input({ signature: `${bad} ${bad}` })))
})

Deno.test('verifySvix: more than 20 signature entries fail', async () => {
  const good = await sign(KEY)
  const bad = await sign(OTHER_KEY)
  const many = (n: number) => [...Array(n - 1).fill(bad), good].join(' ')
  assert(await verifySvix(await input({ signature: many(20) })))
  assertFalse(await verifySvix(await input({ signature: many(21) })))
  // Extra spaces are not entries.
  assert(await verifySvix(await input({ signature: `  ${many(20)}  ` })))
})

Deno.test('verifySvix: only v1 entries count', async () => {
  const value = (await sign(KEY)).slice('v1,'.length)
  assertFalse(await verifySvix(await input({ signature: `v2,${value}` })))
  assertFalse(await verifySvix(await input({ signature: `v1a,${value}` })))
  assertFalse(await verifySvix(await input({ signature: value })))
  assert(await verifySvix(await input({ signature: `v1a,xyz v1,${value}` })))
})

Deno.test('verifySvix: missing headers fail closed', async () => {
  assertFalse(await verifySvix(await input({ id: null })))
  assertFalse(await verifySvix(await input({ timestamp: null })))
  assertFalse(await verifySvix(await input({ signature: null })))
  assertFalse(await verifySvix(await input({ id: '' })))
  assertFalse(await verifySvix(await input({ signature: '' })))
})

Deno.test('verifySvix: an empty or undecodable secret fails closed', async () => {
  assertFalse(await verifySvix(await input({ secret: '' })))
  assertFalse(await verifySvix(await input({ secret: 'whsec_' })))
  assertFalse(await verifySvix(await input({ secret: 'whsec_not*base64!' })))
})

Deno.test('verifySvix: a malformed timestamp fails', async () => {
  for (const timestamp of ['', 'abc', '2e9', ' 2000000000', '-1', '1.5']) {
    const signature = await sign(KEY, BODY, ID, timestamp)
    assertFalse(
      await verifySvix(await input({ timestamp, signature })),
      `timestamp ${JSON.stringify(timestamp)}`,
    )
  }
})

Deno.test('verifySvix: malformed signature entries fail', async () => {
  for (
    const signature of [
      'v1,',
      'v1',
      ',',
      'v1,not*base64!',
      'v1,AAAA', // valid base64, wrong length
      'garbage',
    ]
  ) {
    assertFalse(
      await verifySvix(await input({ signature })),
      `signature ${JSON.stringify(signature)}`,
    )
  }
})
