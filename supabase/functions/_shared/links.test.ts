import {
  assert,
  assertEquals,
  assertFalse,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from '@std/assert'
import { stub } from '@std/testing/mock'
import { FunctionError } from './errors.ts'
import {
  generateToken,
  hashToken,
  isWellFormedToken,
  linkUrl,
} from './links.ts'

/**
 * The bytes 0x00..0x1f, base64url without padding. Its SHA-256 (of the
 * token's UTF-8 bytes) was computed with both Python's `hashlib` and
 * `shasum -a 256`.
 */
const KNOWN_TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const KNOWN_HASH =
  '\\xea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0'
const APP_URL = 'https://app.cliniquemana.com'

/** Fills `getRandomValues` with `fill(index)` for the duration of `fn`. */
function withRandomBytes<T>(fill: (i: number) => number, fn: () => T): T {
  const s = stub(
    crypto,
    'getRandomValues',
    <A extends ArrayBufferView | null>(array: A): A => {
      const bytes = array as unknown as Uint8Array
      for (let i = 0; i < bytes.length; i++) bytes[i] = fill(i)
      return array
    },
  )
  try {
    return fn()
  } finally {
    s.restore()
  }
}

// ---------------------------------------------------------------------------
// generateToken
// ---------------------------------------------------------------------------
Deno.test('generateToken: 1 000 tokens are unique, 43 base64url chars', () => {
  const tokens = new Set<string>()
  for (let i = 0; i < 1_000; i++) {
    const token = generateToken()
    assertMatch(token, /^[A-Za-z0-9_-]{43}$/)
    assert(isWellFormedToken(token))
    tokens.add(token)
  }
  assertEquals(tokens.size, 1_000)
})

Deno.test('generateToken: 32 bytes from getRandomValues, base64url, no padding', () => {
  let requested = 0
  const s = stub(
    crypto,
    'getRandomValues',
    <A extends ArrayBufferView | null>(array: A): A => {
      const bytes = array as unknown as Uint8Array
      requested = bytes.length
      for (let i = 0; i < bytes.length; i++) bytes[i] = i
      return array
    },
  )
  try {
    assertEquals(generateToken(), KNOWN_TOKEN)
  } finally {
    s.restore()
  }
  assertEquals(requested, 32)
})

Deno.test('generateToken: uses the url-safe alphabet (- and _, never + or /)', () => {
  assertEquals(
    withRandomBytes(() => 0xff, generateToken),
    `${'_'.repeat(42)}8`,
  )
  assertEquals(
    withRandomBytes(() => 0xfb, generateToken).slice(0, 4),
    '-_v7',
  )
})

// ---------------------------------------------------------------------------
// hashToken
// ---------------------------------------------------------------------------
Deno.test('hashToken: SHA-256 of the UTF-8 bytes, as a \\x hex bytea literal', async () => {
  assertEquals(await hashToken(KNOWN_TOKEN), KNOWN_HASH)
})

Deno.test('hashToken: 32 bytes (64 lowercase hex digits), deterministic, distinct', async () => {
  const a = generateToken()
  const b = generateToken()
  const [ha1, ha2, hb] = await Promise.all([
    hashToken(a),
    hashToken(a),
    hashToken(b),
  ])
  assertMatch(ha1, /^\\x[0-9a-f]{64}$/)
  assertEquals(ha1, ha2)
  assertNotEquals(ha1, hb)
})

Deno.test('hashToken: refuses a malformed token without echoing it', async () => {
  for (const bad of ['../x', `${KNOWN_TOKEN}=`, KNOWN_TOKEN.slice(1), '']) {
    const err = await assertRejects(() => hashToken(bad), TypeError)
    if (bad) assertFalse(err.message.includes(bad))
  }
})

// ---------------------------------------------------------------------------
// isWellFormedToken
// ---------------------------------------------------------------------------
Deno.test('isWellFormedToken: accepts a canonical 43-char token', () => {
  assert(isWellFormedToken(KNOWN_TOKEN))
  assert(isWellFormedToken(`${'_'.repeat(42)}8`))
  assert(isWellFormedToken(`${'-'.repeat(42)}w`))
})

Deno.test('isWellFormedToken: rejects a path traversal attempt', () => {
  assertFalse(isWellFormedToken('../x'))
})

Deno.test('isWellFormedToken: rejects wrong lengths', () => {
  assertFalse(isWellFormedToken(''))
  assertFalse(isWellFormedToken(KNOWN_TOKEN.slice(0, 42)))
  assertFalse(isWellFormedToken(`${KNOWN_TOKEN}A`))
  assertFalse(isWellFormedToken(KNOWN_TOKEN.repeat(100)))
})

Deno.test('isWellFormedToken: rejects padding and standard base64', () => {
  assertFalse(isWellFormedToken(`${KNOWN_TOKEN}=`))
  assertFalse(isWellFormedToken(`${KNOWN_TOKEN.slice(0, 42)}=`))
  assertFalse(isWellFormedToken(`+${KNOWN_TOKEN.slice(1)}`))
  assertFalse(isWellFormedToken(`/${KNOWN_TOKEN.slice(1)}`))
})

Deno.test('isWellFormedToken: rejects other characters anywhere', () => {
  for (const ch of ['.', ' ', '\n', '%', '#', '&', '\u0000', 'é', 'А']) {
    assertFalse(isWellFormedToken(`${ch}${KNOWN_TOKEN.slice(1)}`), ch)
    assertFalse(
      isWellFormedToken(
        `${KNOWN_TOKEN.slice(0, 21)}${ch}${KNOWN_TOKEN.slice(22)}`,
      ),
      ch,
    )
  }
  assertFalse(isWellFormedToken(` ${KNOWN_TOKEN}`))
  assertFalse(isWellFormedToken(`${KNOWN_TOKEN}\n`))
})

Deno.test('isWellFormedToken: rejects a non-canonical last character', () => {
  // 43 chars carry 258 bits for 256: the last char's two low bits must be 0.
  assertFalse(isWellFormedToken(`${KNOWN_TOKEN.slice(0, 42)}9`))
  assertFalse(isWellFormedToken(`${'_'.repeat(42)}_`))
  assertFalse(isWellFormedToken(`${'A'.repeat(42)}B`))
})

Deno.test('isWellFormedToken: rejects non-strings', () => {
  for (
    const value of [
      undefined,
      null,
      43,
      true,
      {},
      [KNOWN_TOKEN],
      new String(KNOWN_TOKEN),
    ]
  ) {
    assertFalse(isWellFormedToken(value))
  }
})

// ---------------------------------------------------------------------------
// linkUrl
// ---------------------------------------------------------------------------
Deno.test('linkUrl: the token travels in the #t= fragment only', () => {
  const url = linkUrl(APP_URL, '/invitation', KNOWN_TOKEN)
  assertEquals(url, `${APP_URL}/invitation#t=${KNOWN_TOKEN}`)
  const parsed = new URL(url)
  assertEquals(parsed.hash, `#t=${KNOWN_TOKEN}`)
  assertEquals(parsed.search, '')
  assertEquals(parsed.pathname, '/invitation')
  assertFalse(parsed.origin.includes(KNOWN_TOKEN))
})

Deno.test('linkUrl: a trailing slash or an explicit https port is kept clean', () => {
  assertEquals(
    linkUrl(`${APP_URL}/`, '/invitation', KNOWN_TOKEN),
    `${APP_URL}/invitation#t=${KNOWN_TOKEN}`,
  )
  assertEquals(
    linkUrl('https://staging.example.test:8443', '/invitation', KNOWN_TOKEN),
    `https://staging.example.test:8443/invitation#t=${KNOWN_TOKEN}`,
  )
})

Deno.test('linkUrl: accepts http://localhost:5173 (local dev) only', () => {
  assertEquals(
    linkUrl('http://localhost:5173', '/invitation', KNOWN_TOKEN),
    `http://localhost:5173/invitation#t=${KNOWN_TOKEN}`,
  )
  for (
    const bad of [
      'http://app.cliniquemana.com',
      'http://localhost:3000',
      'http://localhost',
      'http://127.0.0.1:5173',
      'http://localhost:5173.evil.test',
    ]
  ) {
    assertThrows(
      () => linkUrl(bad, '/invitation', KNOWN_TOKEN),
      FunctionError,
      undefined,
      bad,
    )
  }
})

Deno.test('linkUrl: refuses an app URL that is not a bare origin', () => {
  for (
    const bad of [
      '',
      'app.cliniquemana.com',
      'not a url',
      'javascript:alert(1)',
      'ftp://app.cliniquemana.com',
      `${APP_URL}/app`,
      `${APP_URL}?x=1`,
      `${APP_URL}#frag`,
      'https://user:pass@app.cliniquemana.com',
    ]
  ) {
    const err = assertThrows(
      () => linkUrl(bad, '/invitation', KNOWN_TOKEN),
      FunctionError,
    )
    assertEquals(err.code, 'server_misconfigured')
    assertFalse(err.message.includes(KNOWN_TOKEN))
  }
})

Deno.test('linkUrl: refuses a malformed token or an unknown path', () => {
  const err = assertThrows(
    () => linkUrl(APP_URL, '/invitation', '../x?y=1'),
    TypeError,
  )
  assertFalse(err.message.includes('../x'))
  assertThrows(
    () => linkUrl(APP_URL, '/admin' as unknown as '/invitation', KNOWN_TOKEN),
    TypeError,
  )
})

// ---------------------------------------------------------------------------
// Never logs
// ---------------------------------------------------------------------------
Deno.test('no export writes to the console', async () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const stubs = methods.map((m) => stub(console, m))
  try {
    const token = generateToken()
    await hashToken(token)
    isWellFormedToken(token)
    linkUrl(APP_URL, '/invitation', token)
    await hashToken('bad').catch(() => {})
    try {
      linkUrl('http://evil.test', '/invitation', token)
    } catch { /* expected */ }
    for (const s of stubs) assertEquals(s.calls.length, 0)
  } finally {
    for (const s of stubs) s.restore()
  }
})
