import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { hashToken } from '../_shared/links.ts'
import {
  type AdminRoute,
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
  INVITEE_EMAIL,
  LINK_ID,
  OTHER_TOKEN,
  peekValid,
  TOKEN,
} from '../_shared/testing/link-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/accept-invite'
const APP = 'http://localhost:5173'
const NEW_USER = '00000000-0000-4000-8000-0000000000c1'
const PASSWORD = 'un mot de passe solide'

const post = (body: unknown, ip = '203.0.113.5') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
      Origin: APP,
    },
    body: JSON.stringify(body),
  })

/** An AuthApiError as supabase-js returns it. */
const authError = (status: number, code: string, message = code) => ({
  error: Object.assign(new Error(message), {
    name: 'AuthApiError',
    status,
    code,
  }),
})

function harness(opts: {
  peek?: unknown
  rpc?: Record<string, RpcRoute>
  admin?: Record<string, AdminRoute>
  moduleEnabled?: boolean
} = {}) {
  const limiter = countingLimiter()
  /** The service client's RPC and admin calls, in one order. */
  const events: string[] = []
  const service = fakeSupabase({
    rpc: Object.fromEntries(
      Object.entries({
        consume_rate_limit: limiter.route,
        peek_secure_link: { data: opts.peek ?? peekValid() },
        module_enabled_for_org: { data: opts.moduleEnabled ?? true },
        resolve_staff_invitation: { data: invitationDisplay() },
        accept_staff_invitation: {
          data: { status: 'accepted', org_id: ORG_ID },
        },
        ...opts.rpc,
      } as Record<string, RpcRoute>).map(([name, route]) => [
        name,
        (args: Record<string, unknown>) => {
          if (name !== 'consume_rate_limit') events.push(name)
          return typeof route === 'function' ? route(args) : route
        },
      ]),
    ),
    admin: Object.fromEntries(
      Object.entries({
        createUser: () => ({ data: { user: { id: NEW_USER } } }),
        deleteUser: () => ({ data: {} }),
        ...opts.admin,
      } as Record<string, AdminRoute>).map(([name, route]) => [
        name,
        (...args: unknown[]) => {
          events.push(name)
          return route(...args)
        },
      ]),
    ),
  })
  const deps: Deps = {
    env: () => undefined,
    fetch: fakeFetch({}).fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => {
      throw new Error('accept-invite has no user')
    },
  }
  return { handler: createHandler(deps), service, events }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: APP,
  }, fn)

const accept = (over: Record<string, unknown> = {}) =>
  post({ token: TOKEN, password: PASSWORD, ...over })

async function errorOf(res: Response) {
  return { status: res.status, ...(await res.json()).error }
}

Deno.test('accept-invite: happy path: peek → createUser → accept_rpc → 200 { status, email }', async () => {
  await run(async () => {
    const hash = await hashToken(TOKEN)
    const { handler, service, events } = harness()
    const res = await handler(accept())
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), APP)
    const text = await res.text()
    assert(!text.includes(TOKEN) && !text.includes(PASSWORD))
    assertEquals(JSON.parse(text), { status: 'accepted', email: INVITEE_EMAIL })
    assertEquals(events, [
      'peek_secure_link',
      'module_enabled_for_org',
      'resolve_staff_invitation',
      'createUser',
      'accept_staff_invitation',
    ])
    const args = (fn: string) => service.calls.find((c) => c.fn === fn)?.args
    assertEquals(args('peek_secure_link'), {
      p_token_hash: hash,
      p_mark_opened: false,
    })
    assertEquals(args('resolve_staff_invitation'), { p_link_id: LINK_ID })
    assertEquals(service.adminCalls[0].args, [{
      email: INVITEE_EMAIL,
      password: PASSWORD,
      email_confirm: true,
    }])
    assertEquals(args('accept_staff_invitation'), {
      p_token_hash: hash,
      p_user_id: NEW_USER,
      p_payload: {},
    })
  })
})

Deno.test('accept-invite: a payload object is passed to accept_rpc', async () => {
  await run(async () => {
    const { handler, service } = harness()
    assertEquals((await handler(accept({ payload: { a: 1 } }))).status, 200)
    const call = service.calls.find((c) => c.fn === 'accept_staff_invitation')
    assertEquals(call?.args.p_payload, { a: 1 })
  })
})

Deno.test('accept-invite: accept_rpc answers a link state → the created user is deleted, 410 with that code', async () => {
  await run(async () => {
    for (const status of ['link_used', 'link_expired', 'link_invalid']) {
      const { handler, service, events } = harness({
        rpc: { accept_staff_invitation: { data: { status } } },
      })
      const error = await errorOf(await handler(accept()))
      assertEquals([error.status, error.code], [410, status])
      assertEquals(events.slice(-2), ['accept_staff_invitation', 'deleteUser'])
      assertEquals(service.adminCalls[1].args, [NEW_USER])
    }
  })
})

Deno.test('accept-invite: accept_rpc errors (or answers nonsense) → the user is deleted, 500', async () => {
  await run(async () => {
    for (
      const route of [
        { error: { code: '22023', message: 'Le compte ne correspond pas' } },
        { data: { status: 'something' } },
        { data: null },
      ]
    ) {
      const { handler, service } = harness({
        rpc: { accept_staff_invitation: route },
      })
      await captureConsole('error', async () => {
        const error = await errorOf(await handler(accept()))
        assertEquals([error.status, error.code], [500, 'internal'])
      })
      assertEquals(service.adminCalls.map((c) => c.method), [
        'createUser',
        'deleteUser',
      ])
    }
  })
})

Deno.test('accept-invite: a failed delete is reported with the user id; the answer is unchanged', async () => {
  await run(async () => {
    const { handler } = harness({
      rpc: { accept_staff_invitation: { data: { status: 'link_used' } } },
      admin: { deleteUser: () => authError(500, 'unexpected_failure') },
    })
    const logged = await captureConsole('error', async () => {
      const error = await errorOf(await handler(accept()))
      assertEquals([error.status, error.code], [410, 'link_used'])
    })
    const report = JSON.parse(String(logged.at(-1)?.[0]))
    assertEquals(report, {
      fn: 'accept-invite',
      code: 'invite_user_cleanup_failed',
      ids: { link_id: LINK_ID, user_id: NEW_USER },
    })
  })
})

Deno.test('accept-invite: createUser email_exists → 409 conflict, no accept_rpc, reported without the address', async () => {
  await run(async () => {
    for (
      const result of [
        authError(422, 'email_exists'),
        // Older GoTrue: no code, the message only.
        authError(
          422,
          '',
          'A user with this email address has already been registered',
        ),
      ]
    ) {
      const { handler, events } = harness({
        admin: { createUser: () => result },
      })
      const logged = await captureConsole('error', async () => {
        const error = await errorOf(await handler(accept()))
        assertEquals([error.status, error.code], [409, 'conflict'])
        assertEquals(
          error.message,
          'Ce lien ne peut plus être utilisé. Communiquez avec la clinique.',
        )
      })
      assert(!events.includes('accept_staff_invitation'))
      const text = JSON.stringify(logged)
      assert(!text.includes(INVITEE_EMAIL) && !text.includes('@'))
      assertEquals(JSON.parse(String(logged.at(-1)?.[0])), {
        fn: 'accept-invite',
        code: 'invite_email_exists',
        ids: { link_id: LINK_ID },
      })
    }
  })
})

Deno.test('accept-invite: another createUser error → 500, nothing consumed; weak_password → 400', async () => {
  await run(async () => {
    const down = harness({
      admin: { createUser: () => authError(500, 'unexpected_failure') },
    })
    await captureConsole('error', async () => {
      const error = await errorOf(await down.handler(accept()))
      assertEquals([error.status, error.code], [500, 'internal'])
    })
    assert(!down.events.includes('accept_staff_invitation'))

    const weak = harness({
      admin: { createUser: () => authError(422, 'weak_password') },
    })
    const error = await errorOf(await weak.handler(accept()))
    assertEquals([error.status, error.code], [400, 'invalid_request'])
    assert(!weak.events.includes('accept_staff_invitation'))
  })
})

Deno.test('accept-invite: a short or over-long password, or a bad payload → 400 before any peek', async () => {
  await run(async () => {
    for (
      const over of [
        { password: 'court' },
        { password: 'é'.repeat(37) }, // 74 bytes
        { password: undefined },
        { payload: [] },
        { payload: { big: 'x'.repeat(4_100) } },
      ]
    ) {
      const { handler, events } = harness()
      const error = await errorOf(await handler(accept(over)))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
      assertEquals(events, [], JSON.stringify(over).slice(0, 40))
    }
  })
})

Deno.test('accept-invite: a malformed token → 410 link_invalid, never looked up', async () => {
  await run(async () => {
    const { handler, events } = harness()
    const error = await errorOf(await handler(accept({ token: '../x' })))
    assertEquals([error.status, error.code], [410, 'link_invalid'])
    assertEquals(events, [])
  })
})

Deno.test('accept-invite: the 11th call from one IP → 429, no peek', async () => {
  await run(async () => {
    const { handler, service, events } = harness({ peek: { state: 'invalid' } })
    for (let i = 0; i < 10; i++) {
      assertEquals((await handler(accept())).status, 410)
    }
    const res = await handler(accept())
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '300')
    assertEquals(events.length, 10)
    assertEquals(service.calls[0].args.p_bucket, 'links.accept_ip')
  })
})

Deno.test('accept-invite: the 6th call on one link (from any IP) → 429 before createUser', async () => {
  await run(async () => {
    const { handler, events } = harness({
      admin: { createUser: () => authError(422, 'email_exists') },
    })
    await captureConsole('error', async () => {
      for (let i = 0; i < 5; i++) {
        assertEquals((await handler(accept())).status, 409)
      }
    })
    const res = await handler(post(
      { token: TOKEN, password: PASSWORD },
      '198.51.100.9',
    ))
    assertEquals(res.status, 429)
    assertEquals(events.filter((e) => e === 'createUser').length, 5)
  })
})

Deno.test('accept-invite: a link that is not valid → 410 with its code, nothing created', async () => {
  await run(async () => {
    for (
      const [peek, code] of [
        [{ state: 'invalid' }, 'link_invalid'],
        [{ state: 'expired', purpose: 'staff_invite' }, 'link_expired'],
        [{ state: 'used', purpose: 'staff_invite' }, 'link_used'],
      ] as const
    ) {
      const { handler, service } = harness({ peek })
      const error = await errorOf(await handler(accept()))
      assertEquals([error.status, error.code], [410, code])
      assertEquals(service.adminCalls, [])
    }
  })
})

Deno.test('accept-invite: a disabled module, or an invitation no longer pending → 410 link_invalid, nothing created', async () => {
  await run(async () => {
    const off = harness({ moduleEnabled: false })
    const unknown = await (await harness({ peek: { state: 'invalid' } })
      .handler(accept({ token: OTHER_TOKEN }))).text()
    assertEquals(await (await off.handler(accept())).text(), unknown)
    assertEquals(off.service.adminCalls, [])

    const gone = harness({ rpc: { resolve_staff_invitation: { data: null } } })
    assertEquals(await (await gone.handler(accept())).text(), unknown)
    assertEquals(gone.service.adminCalls, [])
  })
})

Deno.test('accept-invite: a purpose that creates no account → 400, nothing created', async () => {
  await run(async () => {
    const { handler, service } = harness({
      peek: peekValid({ creates_account: false, requires_session: true }),
    })
    const error = await errorOf(await handler(accept()))
    assertEquals([error.status, error.code], [400, 'invalid_request'])
    assertEquals(service.adminCalls, [])
  })
})

Deno.test('accept-invite: a display without an email, or a purpose without accept_rpc → 500, nothing created', async () => {
  await run(async () => {
    for (
      const opts of [
        { rpc: { resolve_staff_invitation: { data: { clinic_name: 'x' } } } },
        { peek: peekValid({ accept_rpc: null }) },
      ]
    ) {
      const { handler, service } = harness(opts)
      await captureConsole('error', async () => {
        assertEquals((await handler(accept())).status, 500)
      })
      assertEquals(service.adminCalls, [])
    }
  })
})
