import { assertEquals, assertMatch, assertNotEquals } from '@std/assert'
import {
  clientIp,
  consume,
  hashKey,
  limitResponse,
  LIMITS,
  type RateLimit,
} from './rate-limit.ts'
import { byteaHex } from './bytea.ts'
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
Deno.test("clientIp: the rightmost x-forwarded-for entry (the gateway's), trimmed", () => {
  assertEquals(clientIp(withIp('10.0.0.1, 203.0.113.5')), '203.0.113.5')
  assertEquals(clientIp(withIp('  198.51.100.7  ')), '198.51.100.7')
})

Deno.test('clientIp: a forged leftmost entry is ignored', () => {
  // The client sent `x-forwarded-for: 1.2.3.4`; the gateway appended the real one.
  for (const forged of ['1.2.3.4', '198.51.100.99', 'unknown', '::1']) {
    assertEquals(clientIp(withIp(`${forged}, 203.0.113.5`)), '203.0.113.5')
  }
  // Rotating the forged entry does not give a new bucket.
  assertEquals(
    clientIp(withIp('192.0.2.1, 203.0.113.5')),
    clientIp(withIp('192.0.2.2, 203.0.113.5')),
  )
})

Deno.test('clientIp: CLIENT_IP_SOURCE=cf-connecting-ip reads that header only', async () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://fn.test/x', { headers })
  await withEnv({ CLIENT_IP_SOURCE: 'cf-connecting-ip' }, () => {
    assertEquals(
      clientIp(req({
        'cf-connecting-ip': ' 203.0.113.5 ',
        'x-forwarded-for': '198.51.100.7',
      })),
      '203.0.113.5',
    )
    assertEquals(
      clientIp(req({ 'cf-connecting-ip': '2001:db8:0:1::9' })),
      '2001:db8:0:1::/64',
    )
    // No fallback to x-forwarded-for.
    assertEquals(
      clientIp(req({ 'x-forwarded-for': '198.51.100.7' })),
      'unknown',
    )
  })
  for (const source of [undefined, 'xff-rightmost', 'something-else']) {
    await withEnv({ CLIENT_IP_SOURCE: source }, () => {
      assertEquals(
        clientIp(req({
          'cf-connecting-ip': '203.0.113.5',
          'x-forwarded-for': '198.51.100.7',
        })),
        '198.51.100.7',
        String(source),
      )
    })
  }
})

Deno.test('clientIp: a malformed value → unknown', () => {
  for (
    const value of [
      'junk',
      '203.0.113.5, not-an-ip',
      '1',
      '2001:db8:zz::1',
      '203.0.113.5 extra',
      `1.${'1'.repeat(70)}`,
      '<script>',
    ]
  ) {
    assertEquals(clientIp(withIp(value)), 'unknown', value)
  }
})

Deno.test('clientIp: IPv6 is grouped by /64, so addresses in one block share a key', () => {
  const block = '2001:db8:0:1::/64'
  for (
    const ip of [
      '2001:db8:0:1::1',
      '2001:db8:0:1:ffff:ffff:ffff:ffff',
      '2001:0DB8:0000:0001:abcd:0:0:9',
      '[2001:db8:0:1::42]',
      '2001:db8:0:1::1%1', // a numeric zone; `%eth0` fails IP_FORMAT
      '2001:db8:0:1:0:0:192.0.2.1',
    ]
  ) {
    assertEquals(clientIp(withIp(ip)), block, ip)
  }
  assertEquals(clientIp(withIp('2001:db8:0:2::1')), '2001:db8:0:2::/64')
  assertEquals(clientIp(withIp('::1')), '0:0:0:0::/64')
  assertEquals(clientIp(withIp('2001:db8::')), '2001:db8:0:0::/64')
})

Deno.test('clientIp: an IPv4-mapped IPv6 is its IPv4; unparseable values of a valid format are kept', () => {
  assertEquals(clientIp(withIp('::ffff:203.0.113.5')), '203.0.113.5')
  assertEquals(clientIp(withIp('::FFFF:cb00:7105')), '203.0.113.5')
  for (const ip of ['1::2::3', '1:2:3:4:5:6:7:8:9', '999.1.1.1']) {
    assertEquals(clientIp(withIp(ip)), ip, ip)
  }
})

Deno.test('clientIp: unknown when the header is missing or empty', () => {
  assertEquals(clientIp(withIp()), 'unknown')
  assertEquals(clientIp(withIp('10.0.0.1, ')), 'unknown')
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
      byteaHex(await hashKey(['203.0.113.5'], SECRET)),
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
        assertEquals(outcome, {
          allowed: false,
          hits: 0,
          retryAfter: 60,
          reason: 'unavailable',
        })
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
      assertEquals(outcome, {
        allowed: false,
        hits: 0,
        retryAfter: 60,
        reason: 'unavailable',
      })
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
    emailRepeatGuard: ['emails.repeat_guard', 1, 5],
    emailFreeRecipient: ['emails.free_recipient', 20, 3_600],
    linkResolveIp: ['links.resolve_ip', 30, 600],
    inviteAcceptIp: ['links.accept_ip', 10, 3_600],
    inviteAcceptLink: ['links.accept_link', 5, 3_600],
    staffInviteUser: ['invites.staff_user', 30, 3_600],
    professionalInviteUser: ['professionals.invite_user', 30, 3_600],
    professionalInviteFile: ['professionals.invite_file', 1, 5],
    professionalSubmitUser: ['professionals.submit_user', 10, 3_600],
    professionalContractUser: ['professionals.contract_user', 30, 3_600],
    professionalContractResend: ['professionals.contract_resend', 1, 10],
    storageUploadUser: ['storage.upload_user', 60, 3_600],
    storageConfirmUser: ['storage.confirm_user', 120, 3_600],
    storageSignUser: ['storage.sign_user', 120, 3_600],
    signingSyncUser: ['signing.sync_user', 60, 3_600],
    signingTestConnectionUser: ['signing.test_connection_user', 30, 3_600],
    signingTestDocumentUser: ['signing.test_document_user', 10, 3_600],
    ficheEmailUser: ['professionals.fiche_email_user', 30, 3_600],
    emailPreviewUser: ['emails.preview_user', 300, 3_600],
    placesUser: ['places.user', 600, 3_600],
    placesOrg: ['places.org', 3_000, 3_600],
    resendWebhookIp: ['webhooks.resend_ip', 600, 60],
    documensoWebhookIp: ['webhooks.documenso_ip', 600, 60],
  })
  for (const l of Object.values(LIMITS)) {
    assertMatch(l.bucket, /^[a-z][a-z0-9_.]{0,62}$/)
  }
})

// ---------------------------------------------------------------------------
// limitResponse
// ---------------------------------------------------------------------------
Deno.test('limitResponse: null when allowed; 429 with Retry-After when refused; 503 when unavailable', async () => {
  assertEquals(limitResponse({ allowed: true, hits: 1, retryAfter: 0 }), null)

  const refused = limitResponse({ allowed: false, hits: 31, retryAfter: 120 })!
  assertEquals(refused.status, 429)
  assertEquals(refused.headers.get('Retry-After'), '120')
  assertEquals((await refused.json()).error.code, 'rate_limited')

  const closed = limitResponse({
    allowed: false,
    hits: 0,
    retryAfter: 60,
    reason: 'unavailable',
  })!
  assertEquals(closed.status, 503)
  assertEquals(closed.headers.get('Retry-After'), null)
  assertEquals((await closed.json()).error.code, 'not_configured')
})
