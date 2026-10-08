import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { hashToken } from '../_shared/links.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { ORG_ID } from '../_shared/testing/email-fixtures.ts'
import {
  countingLimiter,
  invitationDisplay,
  LINK_ID,
  OTHER_TOKEN,
  peekValid,
  TOKEN,
} from '../_shared/testing/link-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/resolve-link'
const APP = 'http://localhost:5173'

const post = (body: unknown, ip = '203.0.113.5') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
      Origin: APP,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

function harness(opts: {
  /** `peek_secure_link`'s answer, by token hash (others: invalid). */
  peeks?: Record<string, unknown>
  rpc?: Record<string, RpcRoute>
  moduleEnabled?: boolean
  limiterDown?: boolean
} = {}) {
  const limiter = countingLimiter(opts.limiterDown ? ['links.resolve_ip'] : [])
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: limiter.route,
      peek_secure_link: (args) => ({
        data: opts.peeks?.[String(args.p_token_hash)] ?? { state: 'invalid' },
      }),
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      resolve_staff_invitation: { data: invitationDisplay() },
      ...opts.rpc,
    },
  })
  const http = fakeFetch({})
  const deps: Deps = {
    env: () => undefined,
    fetch: http.fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => {
      throw new Error('resolve-link has no user')
    },
  }
  return { handler: createHandler(deps), service }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: APP,
  }, fn)

const names = (calls: { fn: string }[]) => calls.map((c) => c.fn)

/** Status, headers except Date, and body: what « byte-identical » compares. */
async function snapshot(res: Response) {
  const headers = [...res.headers].filter(([k]) => k !== 'date')
  return { status: res.status, headers, body: await res.text() }
}

Deno.test('resolve-link: a valid link → 200 { purpose, display }, marked opened only past the module gate, no token echoed', async () => {
  await run(async () => {
    const hash = await hashToken(TOKEN)
    const { handler, service } = harness({ peeks: { [hash]: peekValid() } })
    const res = await handler(post({ token: TOKEN }))
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), APP)
    const text = await res.text()
    assert(!text.includes(TOKEN))
    assertEquals(JSON.parse(text), {
      purpose: 'staff_invite',
      display: invitationDisplay(),
    })
    assertEquals(names(service.calls), [
      'consume_rate_limit',
      'peek_secure_link',
      'module_enabled_for_org',
      'peek_secure_link',
      'resolve_staff_invitation',
    ])
    assertEquals(service.calls[1].args, {
      p_token_hash: hash,
      p_mark_opened: false,
    })
    assertEquals(service.calls[2].args, { p_org_id: ORG_ID, p_key: 'core' })
    assertEquals(service.calls[3].args, {
      p_token_hash: hash,
      p_mark_opened: true,
    })
    assertEquals(service.calls[4].args, { p_link_id: LINK_ID })
  })
})

Deno.test('resolve-link: the 31st call from one IP → 429 with Retry-After, and no peek', async () => {
  await run(async () => {
    const { handler, service } = harness()
    for (let i = 0; i < 30; i++) {
      assertEquals((await handler(post({ token: TOKEN }))).status, 410)
    }
    const res = await handler(post({ token: TOKEN }))
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '300')
    assertEquals((await res.json()).error.code, 'rate_limited')
    assertEquals(
      names(service.calls).filter((n) => n === 'peek_secure_link').length,
      30,
    )
    // Another IP has its own bucket.
    assertEquals(
      (await handler(post({ token: TOKEN }, '198.51.100.7'))).status,
      410,
    )
  })
})

Deno.test('resolve-link: the limit is taken before the body is read', async () => {
  await run(async () => {
    const { handler, service } = harness()
    const res = await handler(post('not json'))
    assertEquals(res.status, 400)
    assertEquals(names(service.calls), ['consume_rate_limit'])
    assertEquals(service.calls[0].args.p_bucket, 'links.resolve_ip')
  })
})

Deno.test('resolve-link: limiter down → 503 not_configured, no peek', async () => {
  await run(async () => {
    const { handler, service } = harness({ limiterDown: true })
    await captureConsole('error', async () => {
      const res = await handler(post({ token: TOKEN }))
      assertEquals(res.status, 503)
      assertEquals((await res.json()).error.code, 'not_configured')
    })
    assertEquals(names(service.calls), ['consume_rate_limit'])
  })
})

Deno.test('resolve-link: malformed, unknown, revoked, disabled-module and no-longer-pending tokens are byte-identical', async () => {
  await run(async () => {
    const revoked = await hashToken(OTHER_TOKEN)
    const malformed = await snapshot(
      await harness().handler(post({ token: '../x' })),
    )
    assertEquals(malformed.status, 410)
    assertEquals(JSON.parse(malformed.body).error.code, 'link_invalid')

    const variants = [
      // Missing, wrong type, padded, unknown.
      [harness(), {}],
      [harness(), { token: 42 }],
      [harness(), { token: `${TOKEN}=` }],
      [harness(), { token: TOKEN }],
      // Revoked: peek answers exactly the unknown answer.
      [harness({ peeks: { [revoked]: { state: 'invalid' } } }), {
        token: OTHER_TOKEN,
      }],
      [
        harness({
          peeks: { [await hashToken(TOKEN)]: peekValid() },
          moduleEnabled: false,
        }),
        { token: TOKEN },
      ],
      // Revoked or renewed between peek and resolve.
      [
        harness({
          peeks: { [await hashToken(TOKEN)]: peekValid() },
          rpc: { resolve_staff_invitation: { data: null } },
        }),
        { token: TOKEN },
      ],
    ] as const
    for (const [h, body] of variants) {
      assertEquals(
        await snapshot(await h.handler(post(body))),
        malformed,
        JSON.stringify(body),
      )
    }
  })
})

Deno.test('resolve-link: a malformed token is never hashed or looked up', async () => {
  await run(async () => {
    const { handler, service } = harness()
    await handler(post({ token: '../x' }))
    assertEquals(names(service.calls), ['consume_rate_limit'])
  })
})

Deno.test('resolve-link: expired → 410 link_expired; used → 410 link_used; no module check', async () => {
  await run(async () => {
    const hash = await hashToken(TOKEN)
    for (const state of ['expired', 'used'] as const) {
      const { handler, service } = harness({
        peeks: { [hash]: { state, purpose: 'staff_invite' } },
      })
      const res = await handler(post({ token: TOKEN }))
      assertEquals(res.status, 410)
      assertEquals((await res.json()).error.code, `link_${state}`)
      assertEquals(names(service.calls), [
        'consume_rate_limit',
        'peek_secure_link',
      ])
    }
  })
})

Deno.test('resolve-link: a disabled module never marks the link opened nor reaches the purpose RPC', async () => {
  await run(async () => {
    const { handler, service } = harness({
      peeks: { [await hashToken(TOKEN)]: peekValid() },
      moduleEnabled: false,
    })
    assertEquals((await handler(post({ token: TOKEN }))).status, 410)
    assertEquals(names(service.calls), [
      'consume_rate_limit',
      'peek_secure_link',
      'module_enabled_for_org',
    ])
    assertEquals(
      service.calls.filter((c) => c.args.p_mark_opened === true),
      [],
    )
  })
})

Deno.test('resolve-link: a link whose state changes between the two peeks → 410 with the new state, not resolved', async () => {
  await run(async () => {
    for (
      const [later, code] of [
        [{ state: 'invalid' }, 'link_invalid'],
        [{ state: 'used', purpose: 'staff_invite' }, 'link_used'],
        [{ state: 'expired', purpose: 'staff_invite' }, 'link_expired'],
      ] as const
    ) {
      const { handler, service } = harness({
        rpc: {
          peek_secure_link: (args) => ({
            data: args.p_mark_opened ? later : peekValid(),
          }),
        },
      })
      const res = await handler(post({ token: TOKEN }))
      assertEquals(res.status, 410)
      assertEquals((await res.json()).error.code, code)
      assert(!names(service.calls).includes('resolve_staff_invitation'))
    }
  })
})

Deno.test('resolve-link: RPC failures → 500 internal, reported without the token', async () => {
  await run(async () => {
    const hash = await hashToken(TOKEN)
    const cases: Record<string, RpcRoute>[] = [
      { peek_secure_link: { error: { code: 'XX000', message: 'boom' } } },
      // The marking peek fails after the gate.
      {
        peek_secure_link: (args) =>
          args.p_mark_opened
            ? { error: { code: 'XX000', message: 'boom' } }
            : { data: peekValid() },
      },
      { peek_secure_link: { data: peekValid({ resolve_rpc: null }) } },
      { module_enabled_for_org: { error: { code: 'XX000', message: 'x' } } },
      { resolve_staff_invitation: { error: { code: 'XX000', message: 'x' } } },
      { resolve_staff_invitation: { data: 'not an object' } },
    ]
    for (const rpc of cases) {
      const { handler } = harness({ peeks: { [hash]: peekValid() }, rpc })
      const logged = await captureConsole('error', async () => {
        const res = await handler(post({ token: TOKEN }))
        assertEquals(res.status, 500, JSON.stringify(rpc))
        assertEquals((await res.json()).error.code, 'internal')
      })
      const text = JSON.stringify(logged)
      assert(!text.includes(TOKEN) && !text.includes(hash.slice(2)))
    }
  })
})

Deno.test('resolve-link: CORS preflight; other methods → 405', async () => {
  await run(async () => {
    const { handler, service } = harness()
    const preflight = await handler(
      new Request(URL_, { method: 'OPTIONS', headers: { Origin: APP } }),
    )
    assertEquals(preflight.headers.get('Access-Control-Allow-Origin'), APP)
    const get = await handler(new Request(URL_, { headers: { Origin: APP } }))
    assertEquals(get.status, 405)
    assertEquals(service.calls, [])
  })
})
