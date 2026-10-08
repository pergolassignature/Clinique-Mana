import { assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  type AdminRoute,
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_ID,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/users-set-status'
const TARGET = '00000000-0000-4000-8000-0000000000b2'

const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

function harness(opts: {
  permissions?: string[]
  setStatus?: RpcRoute
  updateUser?: AdminRoute
} = {}) {
  /** Both clients' writes, in one order. */
  const events: string[] = []
  const setStatus = opts.setStatus ?? { data: null }
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: accessFixture(opts.permissions ?? ['users.manage', 'users.view']),
      },
      set_user_status: async (args) => {
        events.push(`set_user_status:${args.p_status}`)
        return typeof setStatus === 'function'
          ? await setStatus(args)
          : setStatus
      },
    },
  })
  const service = fakeSupabase({
    admin: {
      updateUserById: (...args) => {
        const attrs = args[1] as { ban_duration: string }
        events.push(`ban:${attrs.ban_duration}`)
        return opts.updateUser?.(...args) ?? { data: { user: { id: TARGET } } }
      },
    },
  })
  const deps: Deps = {
    env: () => undefined,
    fetch: fakeFetch({}).fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), user, service, events }
}

const run = (fn: () => Promise<void>) =>
  withEnv({ SENTRY_DSN: undefined, ALLOWED_ORIGINS: undefined }, fn)

async function errorOf(res: Response) {
  return { status: res.status, ...(await res.json()).error }
}

const authDown = () => ({
  error: Object.assign(new Error('down'), { status: 500, code: 'unexpected' }),
})

Deno.test('users-set-status: disable → set_user_status (as the caller), then the ban → 200 sessions_ended', async () => {
  await run(async () => {
    const { handler, user, service, events } = harness()
    const res = await handler(post({ user_id: TARGET, status: 'disabled' }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { status: 'disabled', sessions_ended: true })
    assertEquals(events, ['set_user_status:disabled', 'ban:876000h'])
    assertEquals(user.calls[1], {
      fn: 'set_user_status',
      args: { p_user_id: TARGET, p_status: 'disabled' },
    })
    assertEquals(service.adminCalls[0].args, [TARGET, {
      ban_duration: '876000h',
    }])
    assertEquals(service.calls, [])
  })
})

Deno.test('users-set-status: a ban failure after the disable → 200 sessions_ended false, reported; the disable stays', async () => {
  await run(async () => {
    const { handler, events } = harness({ updateUser: authDown })
    const logged = await captureConsole('error', async () => {
      const res = await handler(post({ user_id: TARGET, status: 'disabled' }))
      assertEquals(res.status, 200)
      assertEquals(await res.json(), {
        status: 'disabled',
        sessions_ended: false,
      })
    })
    assertEquals(events, ['set_user_status:disabled', 'ban:876000h'])
    assertEquals(JSON.parse(String(logged.at(-1)?.[0])), {
      fn: 'users-set-status',
      code: 'auth_ban_failed',
      ids: { org_id: ORG_ID, user_id: TARGET },
    })
  })
})

Deno.test('users-set-status: disabling an already-disabled user retries the ban; sessions_ended follows the new attempt', async () => {
  await run(async () => {
    // set_user_status is a no-op for an unchanged status (it answers null).
    let banFails = true
    const { handler, events } = harness({
      updateUser: () =>
        banFails ? authDown() : { data: { user: { id: TARGET } } },
    })
    await captureConsole('error', async () => {
      const first = await handler(post({ user_id: TARGET, status: 'disabled' }))
      assertEquals(await first.json(), {
        status: 'disabled',
        sessions_ended: false,
      })
    })
    banFails = false
    const retry = await handler(post({ user_id: TARGET, status: 'disabled' }))
    assertEquals(retry.status, 200)
    assertEquals(await retry.json(), {
      status: 'disabled',
      sessions_ended: true,
    })
    assertEquals(events, [
      'set_user_status:disabled',
      'ban:876000h',
      'set_user_status:disabled',
      'ban:876000h',
    ])
  })
})

Deno.test('users-set-status: enable → set_user_status, then the unban (ban_duration none) → 200', async () => {
  await run(async () => {
    const { handler, events } = harness()
    const res = await handler(post({ user_id: TARGET, status: 'active' }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { status: 'active' })
    assertEquals(events, ['set_user_status:active', 'ban:none'])
  })
})

Deno.test('users-set-status: an unban failure → the status is put back to disabled, 502 provider_error', async () => {
  await run(async () => {
    const { handler, events } = harness({ updateUser: authDown })
    const logged = await captureConsole('error', async () => {
      const error = await errorOf(
        await handler(post({ user_id: TARGET, status: 'active' })),
      )
      assertEquals([error.status, error.code], [502, 'provider_error'])
    })
    assertEquals(events, [
      'set_user_status:active',
      'ban:none',
      'set_user_status:disabled',
    ])
    assertEquals(
      JSON.parse(String(logged.at(-1)?.[0])).code,
      'auth_unban_failed',
    )
  })
})

Deno.test('users-set-status: a failed roll-back after an unban failure is reported too', async () => {
  await run(async () => {
    const { handler } = harness({
      updateUser: authDown,
      setStatus: (args) =>
        args.p_status === 'disabled'
          ? { error: { code: 'XX000', message: 'boom' } }
          : { data: null },
    })
    const logged = await captureConsole('error', async () => {
      assertEquals(
        (await handler(post({ user_id: TARGET, status: 'active' }))).status,
        502,
      )
    })
    assertEquals(
      logged.map((l) => JSON.parse(String(l[0])).code),
      ['auth_unban_failed', 'status_rollback_failed'],
    )
  })
})

Deno.test('users-set-status: an RPC refusal → its answer, and Auth is never called', async () => {
  await run(async () => {
    const message = 'Seul un administrateur peut réactiver un compte.'
    for (
      const [error, status, code] of [
        [{ code: 'P0001', message }, 400, 'invalid_request'],
        [{ code: '42501', message: 'Permission refusée' }, 403, 'forbidden'],
        [{ code: '22023', message: 'Statut inconnu' }, 400, 'invalid_request'],
      ] as const
    ) {
      const { handler, service } = harness({ setStatus: { error } })
      const body = await errorOf(
        await handler(post({ user_id: TARGET, status: 'active' })),
      )
      assertEquals([body.status, body.code], [status, code])
      if (error.code === 'P0001') assertEquals(body.message, message)
      assertEquals(service.adminCalls, [])
    }
  })
})

Deno.test('users-set-status: another RPC error → 500, reported; Auth never called', async () => {
  await run(async () => {
    const { handler, service } = harness({
      setStatus: { error: { code: 'XX000', message: 'boom' } },
    })
    const logged = await captureConsole('error', async () => {
      const error = await errorOf(
        await handler(post({ user_id: TARGET, status: 'disabled' })),
      )
      assertEquals([error.status, error.code], [500, 'internal'])
    })
    assertEquals(
      JSON.parse(String(logged.at(-1)?.[0])).code,
      'set_status_failed',
    )
    assertEquals(service.adminCalls, [])
  })
})

Deno.test('users-set-status: no users.manage → 403; no token → 401; a bad body → 400; nothing changed', async () => {
  await run(async () => {
    const denied = harness({ permissions: ['users.view'] })
    const error = await errorOf(
      await denied.handler(post({ user_id: TARGET, status: 'disabled' })),
    )
    assertEquals([error.status, error.code], [403, 'forbidden'])
    assertEquals(
      (await denied.handler(
        post({ user_id: TARGET, status: 'disabled' }, null),
      ))
        .status,
      401,
    )
    assertEquals(denied.events, [])

    for (
      const body of [
        {},
        { user_id: 'nope', status: 'disabled' },
        { user_id: TARGET, status: 'banned' },
      ]
    ) {
      const { handler, events } = harness()
      const bad = await errorOf(await handler(post(body)))
      assertEquals([bad.status, bad.code], [400, 'invalid_request'])
      assertEquals(events, [])
    }
  })
})
