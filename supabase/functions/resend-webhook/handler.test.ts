import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler, createReportThrottle } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { ORG_ID } from '../_shared/testing/email-fixtures.ts'

const SECRET = 'whsec_bG9jYWwtZGV2LXJlc2VuZC13ZWJob29r'
const NOW = '2026-10-08T15:00:00Z'
const NOW_S = Date.parse(NOW) / 1000
const LOG_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const OTHER_LOG_ID = '7f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5f'
const RESEND_ID = '56761188-7520-42d8-8898-ff6fc54ce618'
const EVENT_ID = 'msg_2mXH7c0kB0nK1bU9qQe2f'
const CLAIM = { status: 'claimed', id: 'we-1', claim_token: 'tok-1' }
/** The rate limiter's HMAC key (`consume` reads it from the env). */
const LIMITER_SECRET = 'local-dev-test-secret'
const ALLOWED = { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }] }

/** A Resend event as delivered (with the address, which must not be kept). */
function event(type = 'email.delivered', data: Record<string, unknown> = {}) {
  return {
    type,
    created_at: '2026-10-08T14:59:58.123Z',
    data: {
      created_at: '2026-10-08T14:59:50.000Z',
      email_id: RESEND_ID,
      from: 'Clinique MANA <no-reply@gestion.cliniquemana.com>',
      to: ['ana.gagnon@example.com'],
      subject: 'Votre accès à Clinique MANA',
      tags: { email_log_id: LOG_ID },
      ...data,
    },
  }
}

async function sign(
  id: string,
  timestamp: number,
  body: string,
  secret = SECRET,
): Promise<string> {
  const raw = Uint8Array.from(
    atob(secret.replace(/^whsec_/, '')),
    (c) => c.charCodeAt(0),
  )
  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`
}

async function signed(
  payload: unknown,
  opts: { org?: string; timestamp?: number; secret?: string; raw?: string } =
    {},
): Promise<Request> {
  const body = opts.raw ?? JSON.stringify(payload)
  const timestamp = opts.timestamp ?? NOW_S
  return new Request(
    `http://fn.test/functions/v1/resend-webhook?org=${opts.org ?? ORG_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'svix-id': EVENT_ID,
        'svix-timestamp': String(timestamp),
        'svix-signature': await sign(EVENT_ID, timestamp, body, opts.secret),
      },
      body,
    },
  )
}

function harness(rpc: Record<string, RpcRoute> = {}) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: ALLOWED,
      get_org_secret: { data: SECRET },
      claim_webhook_event: { data: [CLAIM] },
      apply_email_event: { data: 'applied' },
      complete_webhook_event: { data: true },
      fail_webhook_event: { data: true },
      ...rpc,
    },
  })
  const clock = fixedClock(NOW)
  const deps: Deps = {
    env: () => undefined,
    fetch: fakeFetch({}).fetch,
    now: clock.now,
    serviceClient: () => service.client,
    userClient: () => new Response(null, { status: 500 }),
  }
  /** The calls after the per-IP limit (its own tests check it). */
  const names = () =>
    service.calls.map((c) => c.fn).filter((fn) => fn !== 'consume_rate_limit')
  const args = (fn: string) => service.calls.find((c) => c.fn === fn)?.args
  const inner = createHandler(deps)
  const handler = async (req: Request): Promise<Response> => {
    let res: Response | undefined
    await withEnv({ INTERNAL_FUNCTION_SECRET: LIMITER_SECRET }, async () => {
      res = await inner(req)
    })
    return res!
  }
  return { handler, service, names, args, clock }
}

/** No Sentry: reports are console lines, returned for inspection. */
const run = (fn: () => Promise<void>) =>
  withEnv({ SENTRY_DSN: undefined }, async () => {
    await captureConsole('warn', fn)
  })

Deno.test('resend-webhook: email.delivered → claim (ids only) → apply → complete → 200', async () => {
  await run(async () => {
    const { handler, names, args } = harness()
    const res = await handler(await signed(event()))
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), null)
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    assertEquals(names(), [
      'get_org_secret',
      'claim_webhook_event',
      'apply_email_event',
      'complete_webhook_event',
    ])
    assertEquals(args('get_org_secret'), {
      p_org_id: ORG_ID,
      p_key: 'resend_webhook_secret',
    })
    const claim = args('claim_webhook_event')!
    assertEquals(claim, {
      p_provider: 'resend',
      p_event_id: EVENT_ID,
      p_org_id: ORG_ID,
      p_event_type: 'email.delivered',
      p_payload: {
        type: 'email.delivered',
        email_id: RESEND_ID,
        email_log_id: LOG_ID,
      },
    })
    assert(!JSON.stringify(claim).includes('example.com'))
    assertEquals(args('apply_email_event'), {
      p_org_id: ORG_ID,
      p_email_log_id: LOG_ID,
      p_resend_id: RESEND_ID,
      p_status: 'delivered',
      p_at: '2026-10-08T14:59:58.123Z',
    })
    assertEquals(args('complete_webhook_event'), {
      p_id: 'we-1',
      p_claim_token: 'tok-1',
    })
  })
})

Deno.test('resend-webhook: each mapped type, and the array form of tags', async () => {
  await run(async () => {
    const types = {
      'email.sent': 'sent',
      'email.delivered': 'delivered',
      'email.delivery_delayed': 'delivery_delayed',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
      'email.suppressed': 'bounced',
      'email.failed': 'failed',
    }
    for (const [type, status] of Object.entries(types)) {
      const { handler, args } = harness()
      const res = await handler(
        await signed(event(type, {
          tags: [{ name: 'category', value: 'x' }, {
            name: 'email_log_id',
            value: OTHER_LOG_ID,
          }],
        })),
      )
      assertEquals(res.status, 200, type)
      assertEquals(args('apply_email_event')?.p_status, status)
      assertEquals(args('apply_email_event')?.p_email_log_id, OTHER_LOG_ID)
    }
  })
})

Deno.test('resend-webhook: no usable email_log_id tag → 200 skipped before the claim, no report', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    for (
      const tags of [
        undefined,
        { email_log_id: 'not-a-uuid' },
        [{ name: 'category', value: 'newsletter' }],
        [],
      ]
    ) {
      const { handler, names } = harness()
      const logged = await captureConsole('error', async () => {
        const res = await handler(
          await signed(event('email.bounced', { tags })),
        )
        assertEquals(res.status, 200)
        assertEquals(await res.json(), { outcome: 'skipped' })
      })
      assertEquals(names(), ['get_org_secret'], JSON.stringify(tags))
      assertEquals(logged, [])
    }
  })
})

Deno.test('resend-webhook: an untagged event is still verified first (bad signature → 401)', async () => {
  await run(async () => {
    const { handler, names } = harness()
    const res = await handler(
      await signed(event('email.bounced', { tags: undefined }), {
        secret: 'whsec_' + btoa('another-secret'),
      }),
    )
    assertEquals(res.status, 401)
    assertEquals(names(), ['get_org_secret'])
  })
})

Deno.test('resend-webhook: a bad signature → 401, no RPC after get_org_secret', async () => {
  await run(async () => {
    const { handler, names } = harness()
    const res = await handler(
      await signed(event(), { secret: 'whsec_' + btoa('another-secret') }),
    )
    assertEquals(res.status, 401)
    assertEquals(names(), ['get_org_secret'])
  })
})

Deno.test('resend-webhook: a tampered body → 401', async () => {
  await run(async () => {
    const { handler, names } = harness()
    const req = await signed(event())
    const tampered = new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(event('email.bounced')),
    })
    assertEquals((await handler(tampered)).status, 401)
    assertEquals(names(), ['get_org_secret'])
  })
})

Deno.test('resend-webhook: a stale timestamp (301 s) → 401', async () => {
  await run(async () => {
    const { handler } = harness()
    const res = await handler(
      await signed(event(), { timestamp: NOW_S - 301 }),
    )
    assertEquals(res.status, 401)
  })
})

Deno.test('resend-webhook: one hit per IP (the rightmost x-forwarded-for) before the secret is read', async () => {
  await run(async () => {
    const { handler, service } = harness()
    const req = await signed(event())
    req.headers.set('x-forwarded-for', '198.51.100.7, 203.0.113.9')
    assertEquals((await handler(req)).status, 200)
    assertEquals(service.calls.slice(0, 2).map((c) => c.fn), [
      'consume_rate_limit',
      'get_org_secret',
    ])
    const limit = service.calls[0].args
    assertEquals([limit.p_bucket, limit.p_max, limit.p_window_seconds], [
      'webhooks.resend_ip',
      600,
      60,
    ])
    assertFalse(JSON.stringify(limit).includes('203.0.113.9'), 'only a hash')
  })
})

Deno.test('resend-webhook: over the per-IP limit → 429 with Retry-After; the limiter down → 503; the secret is never read', async () => {
  await run(async () => {
    for (
      const [route, status, retryAfter] of [
        [
          { data: [{ allowed: false, hits: 601, retry_after_seconds: 42 }] },
          429,
          '42',
        ],
        [{ error: { code: '57014' } }, 503, null],
      ] as const
    ) {
      const { handler, service } = harness({ consume_rate_limit: route })
      let res: Response | undefined
      await captureConsole('error', async () => {
        res = await handler(await signed(event()))
      })
      assertEquals(res!.status, status)
      assertEquals(res!.headers.get('Retry-After'), retryAfter)
      assertEquals(service.calls.map((c) => c.fn), ['consume_rate_limit'])
    }
  })
})

Deno.test('resend-webhook: missing Svix headers → 401 before any RPC', async () => {
  await run(async () => {
    const { handler, names, service } = harness()
    const res = await handler(
      new Request(`http://fn.test/resend-webhook?org=${ORG_ID}`, {
        method: 'POST',
        body: JSON.stringify(event()),
      }),
    )
    assertEquals(res.status, 401)
    assertEquals(names(), [])
    assertEquals(service.calls, [], 'not even the rate limit')
  })
})

Deno.test('resend-webhook: no secret for the org → 401, reported', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    const { handler, names } = harness({ get_org_secret: { data: null } })
    const logged = await captureConsole('error', async () => {
      assertEquals((await handler(await signed(event()))).status, 401)
    })
    assertEquals(names(), ['get_org_secret'])
    assertEquals(JSON.parse(String(logged[0][0])), {
      fn: 'resend-webhook',
      code: 'resend_webhook_secret_missing',
      ids: { org_id: ORG_ID },
    })
  })
})

Deno.test('resend-webhook: a missing secret is reported once per org per hour; other hits are console lines', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    const { handler, clock } = harness({ get_org_secret: { data: null } })
    const OTHER_ORG = '0b9d7c1e-2f3a-4b5c-9d8e-7f6a5b4c3d2e'
    const hit = async (org = ORG_ID) => {
      assertEquals((await handler(await signed(event(), { org }))).status, 401)
    }
    let warned: unknown[][] = []
    const reported = await captureConsole('error', async () => {
      warned = await captureConsole('warn', async () => {
        await hit()
        await hit()
        await hit(ORG_ID.toUpperCase())
        clock.advance(59 * 60 * 1000)
        await hit()
        await hit(OTHER_ORG)
        clock.advance(60 * 1000)
        await hit()
      })
    })
    const codes = reported.map((r) => JSON.parse(String(r[0])))
    assertEquals(codes, [
      {
        fn: 'resend-webhook',
        code: 'resend_webhook_secret_missing',
        ids: { org_id: ORG_ID },
      },
      {
        fn: 'resend-webhook',
        code: 'resend_webhook_secret_missing',
        ids: { org_id: OTHER_ORG },
      },
      {
        fn: 'resend-webhook',
        code: 'resend_webhook_secret_missing',
        ids: { org_id: ORG_ID },
      },
    ])
    assertEquals(warned.length, 3)
    for (const [line] of warned) {
      const parsed = JSON.parse(String(line))
      assertEquals(parsed.code, 'resend_webhook_secret_missing')
      assertEquals(Object.keys(parsed.ids), ['org_id'])
    }
  })
})

Deno.test('createReportThrottle: once per key per window; the map is capped, the oldest evicted', () => {
  const allow = createReportThrottle(1_000, 2)
  assert(allow('a', 0))
  assertFalse(allow('a', 999))
  assert(allow('a', 1_000))
  assert(allow('b', 1_000))
  assert(allow('c', 1_000)) // evicts `a`, the oldest
  assert(allow('a', 1_001)) // forgotten, so reported again (evicts `b`)
  assertFalse(allow('c', 1_002))
  assert(allow('b', 1_003))
})

Deno.test('resend-webhook: the secret cannot be read → 500 (Resend retries)', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    const { handler } = harness({
      get_org_secret: { error: { code: 'XX000' } },
    })
    await captureConsole('error', async () => {
      assertEquals((await handler(await signed(event()))).status, 500)
    })
  })
})

Deno.test('resend-webhook: org missing or not a uuid → 400, nothing read', async () => {
  await run(async () => {
    const { handler, names } = harness()
    for (const org of ['', 'abc', `${ORG_ID}x`]) {
      const res = await handler(await signed(event(), { org }))
      assertEquals(res.status, 400, org)
    }
    const noParam = await handler(
      new Request('http://fn.test/resend-webhook', { method: 'POST' }),
    )
    assertEquals(noParam.status, 400)
    assertEquals(names(), [])
  })
})

Deno.test('resend-webhook: only POST', async () => {
  await run(async () => {
    const { handler, names } = harness()
    const res = await handler(
      new Request(`http://fn.test/resend-webhook?org=${ORG_ID}`, {
        method: 'OPTIONS',
      }),
    )
    assertEquals(res.status, 405)
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), null)
    assertEquals(names(), [])
  })
})

Deno.test('resend-webhook: a body over 64 KB → 413, nothing read', async () => {
  await run(async () => {
    const { handler, names } = harness()
    const res = await handler(
      await signed(null, { raw: JSON.stringify({ pad: 'x'.repeat(65_536) }) }),
    )
    assertEquals(res.status, 413)
    assertEquals(names(), [])
  })
})

Deno.test('resend-webhook: a signed body that is not an event → 400, nothing claimed', async () => {
  await run(async () => {
    const { handler, names } = harness()
    for (const raw of ['not json', '{"type":42}', '[]']) {
      assertEquals((await handler(await signed(null, { raw }))).status, 400)
    }
    assertEquals(names(), [
      'get_org_secret',
      'get_org_secret',
      'get_org_secret',
    ])
  })
})

Deno.test('resend-webhook: a duplicate → 200 without apply_email_event', async () => {
  await run(async () => {
    const { handler, names } = harness({
      claim_webhook_event: {
        data: [{ status: 'duplicate', id: null, claim_token: null }],
      },
    })
    assertEquals((await handler(await signed(event()))).status, 200)
    assertEquals(names(), ['get_org_secret', 'claim_webhook_event'])
  })
})

Deno.test('resend-webhook: in progress → 409 (Resend retries later)', async () => {
  await run(async () => {
    const { handler, names } = harness({
      claim_webhook_event: {
        data: [{ status: 'in_progress', id: null, claim_token: null }],
      },
    })
    assertEquals((await handler(await signed(event()))).status, 409)
    assertEquals(names(), ['get_org_secret', 'claim_webhook_event'])
  })
})

Deno.test('resend-webhook: an unmapped type → 200 and completed, nothing applied', async () => {
  await run(async () => {
    const { handler, names } = harness()
    assertEquals(
      (await handler(await signed(event('email.opened')))).status,
      200,
    )
    assertEquals(names(), [
      'get_org_secret',
      'claim_webhook_event',
      'complete_webhook_event',
    ])
  })
})

Deno.test('resend-webhook: ignored (disabled module, final row) → 200 and completed', async () => {
  await run(async () => {
    const { handler, names } = harness({
      apply_email_event: { data: 'ignored' },
    })
    assertEquals((await handler(await signed(event()))).status, 200)
    assertEquals(names().at(-1), 'complete_webhook_event')
  })
})

Deno.test('resend-webhook: another org email_log_id → not_found → 200, completed, reported', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    const { handler, names } = harness({
      apply_email_event: { data: 'not_found' },
    })
    const logged = await captureConsole('error', async () => {
      assertEquals((await handler(await signed(event()))).status, 200)
    })
    assertEquals(names().at(-1), 'complete_webhook_event')
    assertEquals(logged.length, 1)
    assertEquals(JSON.parse(String(logged[0][0])), {
      fn: 'resend-webhook',
      code: 'email_event_not_found',
      ids: { org_id: ORG_ID, webhook_event_id: 'we-1', email_log_id: LOG_ID },
    })
  })
})

Deno.test('resend-webhook: apply fails → fail_webhook_event → 500', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    const { handler, names, args } = harness({
      apply_email_event: { error: { code: '22023' } },
    })
    await captureConsole('error', async () => {
      assertEquals((await handler(await signed(event()))).status, 500)
    })
    assertEquals(names().at(-1), 'fail_webhook_event')
    assertEquals(args('fail_webhook_event'), {
      p_id: 'we-1',
      p_claim_token: 'tok-1',
      p_error: 'apply_email_event_failed',
    })
  })
})

Deno.test('resend-webhook: the claim fails → 500', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    const { handler, names } = harness({
      claim_webhook_event: { error: { code: '22023' } },
    })
    await captureConsole('error', async () => {
      assertEquals((await handler(await signed(event()))).status, 500)
    })
    assertEquals(names(), ['get_org_secret', 'claim_webhook_event'])
  })
})
