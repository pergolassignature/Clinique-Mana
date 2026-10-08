import { assertEquals, assertMatch, assertNotEquals } from '@std/assert'
import {
  clientIp,
  consume,
  hashKey,
  LIMITS,
  type RateLimit,
} from './rate-limit.ts'
import { captureConsole, withEnv } from './testing/env.ts'
import { fakeSupabase } from './testing/fake-supabase.ts'

const SECRET = 'local-dev-internal-function-secret'
const LIMIT: RateLimit = { bucket: 'test.bucket', max: 2, windowSeconds: 60 }

const withIp = (value?: string) =>
  new Request('https://fn.test/x', {
    headers: value === undefined ? {} : { 'x-forwarded-for': value },
  })

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// ---------------------------------------------------------------------------
// clientIp
// ---------------------------------------------------------------------------
Deno.test('clientIp: the first x-forwarded-for hop, trimmed', () => {
  assertEquals(clientIp(withIp('203.0.113.5, 10.0.0.1')), '203.0.113.5')
  assertEquals(clientIp(withIp('  2001:db8::1  ')), '2001:db8::1')
})

Deno.test('clientIp: unknown when the header is missing or empty', () => {
  assertEquals(clientIp(withIp()), 'unknown')
  assertEquals(clientIp(withIp(' , 10.0.0.1')), 'unknown')
})

// ---------------------------------------------------------------------------
// hashKey
// ---------------------------------------------------------------------------
Deno.test('hashKey: deterministic, 32 bytes', async () => {
  const a = await hashKey(['203.0.113.5'], SECRET)
  assertEquals(a.length, 32)
  assertEquals(hex(await hashKey(['203.0.113.5'], SECRET)), hex(a))
})

Deno.test('hashKey: differs by secret and by parts (no join ambiguity)', async () => {
  const base = hex(await hashKey(['a', 'b'], SECRET))
  assertNotEquals(hex(await hashKey(['a', 'b'], 'other-secret')), base)
  assertNotEquals(hex(await hashKey(['ab'], SECRET)), base)
  assertNotEquals(hex(await hashKey(['a', 'c'], SECRET)), base)
})

// ---------------------------------------------------------------------------
// consume
// ---------------------------------------------------------------------------
Deno.test('consume: calls consume_rate_limit with the hex-encoded hash and maps the result', async () => {
  const { client, calls } = fakeSupabase({
    rpc: {
      consume_rate_limit: {
        data: [{ allowed: false, hits: 3, retry_after_seconds: 42 }],
      },
    },
  })
  await withEnv({ INTERNAL_FUNCTION_SECRET: SECRET }, async () => {
    assertEquals(await consume(client, LIMIT, ['203.0.113.5']), {
      allowed: false,
      hits: 3,
      retryAfter: 42,
    })
    assertEquals(calls.length, 1)
    const args = calls[0].args
    assertEquals(calls[0].fn, 'consume_rate_limit')
    assertEquals(args.p_bucket, 'test.bucket')
    assertEquals(args.p_max, 2)
    assertEquals(args.p_window_seconds, 60)
    assertEquals(
      args.p_key_hash,
      `\\x${hex(await hashKey(['203.0.113.5'], SECRET))}`,
    )
    assertMatch(String(args.p_key_hash), /^\\x[0-9a-f]{64}$/)
  })
})

Deno.test('consume: an allowed hit maps to allowed with no wait', async () => {
  const { client } = fakeSupabase({
    rpc: {
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
    },
  })
  await withEnv({ INTERNAL_FUNCTION_SECRET: SECRET }, async () => {
    assertEquals(await consume(client, LIMIT, ['k']), {
      allowed: true,
      hits: 1,
      retryAfter: 0,
    })
  })
})

Deno.test('consume: fails closed and reports on an RPC error or a malformed result', async () => {
  for (
    const result of [
      { error: { code: '22023', message: 'Invalid rate limit arguments' } },
      { data: [] },
      { data: [{ allowed: 'yes', hits: 1, retry_after_seconds: 0 }] },
    ]
  ) {
    const { client } = fakeSupabase({ rpc: { consume_rate_limit: result } })
    await withEnv(
      { INTERNAL_FUNCTION_SECRET: SECRET, SENTRY_DSN: undefined },
      async () => {
        let outcome
        const lines = await captureConsole('error', async () => {
          outcome = await consume(client, LIMIT, ['k'])
        })
        assertEquals(outcome, { allowed: false, hits: 0, retryAfter: 60 })
        assertEquals(lines.length, 1)
        assertEquals(JSON.parse(String(lines[0][0])), {
          fn: 'rate-limit',
          code: 'rate_limit_unavailable',
          ids: { bucket: 'test.bucket' },
        })
      },
    )
  }
})

Deno.test('consume: fails closed without calling the RPC when the secret is missing', async () => {
  const { client, calls } = fakeSupabase({})
  await withEnv(
    { INTERNAL_FUNCTION_SECRET: undefined, SENTRY_DSN: undefined },
    async () => {
      let outcome
      const lines = await captureConsole('error', async () => {
        outcome = await consume(client, LIMIT, ['k'])
      })
      assertEquals(outcome, { allowed: false, hits: 0, retryAfter: 60 })
      assertEquals(JSON.parse(String(lines[0][0])).code, 'not_configured')
      assertEquals(calls.length, 0)
    },
  )
})

// ---------------------------------------------------------------------------
// LIMITS (design §2.6, §3.2; P3-18)
// ---------------------------------------------------------------------------
Deno.test('LIMITS: the design values, with valid bucket names', () => {
  const view = Object.fromEntries(
    Object.entries(LIMITS).map((
      [k, l],
    ) => [k, [l.bucket, l.max, l.windowSeconds]]),
  )
  assertEquals(view, {
    emailTest: ['emails.test', 10, 3_600],
    emailOrgDay: ['emails.org_day', 500, 86_400],
    emailSameAddress: ['emails.same_address', 1, 60],
    emailFreeRecipient: ['emails.free_recipient', 20, 3_600],
    linkResolveIp: ['links.resolve_ip', 30, 600],
    inviteAcceptIp: ['links.accept_ip', 10, 3_600],
    inviteAcceptLink: ['links.accept_link', 5, 3_600],
  })
  for (const l of Object.values(LIMITS)) {
    assertMatch(l.bucket, /^[a-z][a-z0-9_.]{0,62}$/)
  }
})
