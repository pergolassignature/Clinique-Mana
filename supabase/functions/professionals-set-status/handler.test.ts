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
import { ORG_ID } from '../_shared/testing/email-fixtures.ts'
import {
  PROFESSIONAL_ID,
  professionalsAccess,
  PROVIDER_ID,
} from '../_shared/testing/professionals-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/professionals-set-status'
const APP = 'http://localhost:5173'
const REASON_ID = '00000000-0000-4000-8000-0000000000e1'
const OTHER_USER = '00000000-0000-4000-8000-0000000000f9'
const MANAGE = ['professionals.manage', 'professionals.view']

const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: APP,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

const DEACTIVATE = {
  action: 'deactivate',
  professional_id: PROFESSIONAL_ID,
  reason_id: REASON_ID,
}
const ACTIVATE = { action: 'activate', professional_id: PROFESSIONAL_ID }
const SYNC = { action: 'sync_signin', professional_id: PROFESSIONAL_ID }

const row = (
  status: 'active' | 'inactive',
  change: 'disabled' | 'enabled' | null,
) => ({
  data: [{
    status,
    account_change: change,
    profile_id: change ? PROVIDER_ID : null,
  }],
})

function harness(opts: {
  access?: Record<string, unknown>
  deactivate?: RpcRoute
  activate?: RpcRoute
  account?: RpcRoute
  updateUser?: AdminRoute
  serviceDown?: boolean
} = {}) {
  /** Both clients' writes, in one order. */
  const events: string[] = []
  const logged = (name: string, route: RpcRoute): RpcRoute => async (args) => {
    events.push(name)
    return typeof route === 'function' ? await route(args) : route
  }
  const user = fakeSupabase({
    user: { id: OTHER_USER },
    rpc: {
      get_my_access: {
        data: opts.access ??
          professionalsAccess(MANAGE, { user_id: OTHER_USER }),
      },
      deactivate_professional: logged(
        'deactivate',
        opts.deactivate ?? row('inactive', 'disabled'),
      ),
      activate_professional: logged(
        'activate',
        opts.activate ?? row('active', 'enabled'),
      ),
      get_professional_account_status: logged(
        'account',
        opts.account ??
          { data: [{ profile_id: PROVIDER_ID, account_status: 'disabled' }] },
      ),
    },
  })
  const service = fakeSupabase({
    admin: {
      updateUserById: (...args) => {
        const attrs = args[1] as { ban_duration: string }
        events.push(`ban:${args[0]}:${attrs.ban_duration}`)
        return opts.updateUser?.(...args) ??
          { data: { user: { id: String(args[0]) } } }
      },
    },
  })
  const deps: Deps = {
    env: () => undefined,
    fetch: fakeFetch({}).fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
    serviceClient: () =>
      opts.serviceDown
        ? new Response(
          JSON.stringify({ error: { code: 'server_misconfigured' } }),
          { status: 500 },
        )
        : service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), user, service, events }
}

const run = (fn: () => Promise<void>) =>
  withEnv({ SENTRY_DSN: undefined, ALLOWED_ORIGINS: APP }, fn)

async function errorOf(res: Response) {
  return { status: res.status, ...(await res.json()).error }
}

/** Every console.error line a run writes, parsed. */
async function reports(
  fn: () => Promise<void>,
): Promise<Record<string, unknown>[]> {
  const logged = await captureConsole('error', fn)
  return logged.map((l) => JSON.parse(String(l[0])))
}

const authDown = () => ({
  error: Object.assign(new Error('down'), { status: 500, code: 'unexpected' }),
})

Deno.test('professionals-set-status: CORS, method, auth, permission, module and body gates; nothing changed when refused', async () => {
  await run(async () => {
    const ok = harness()
    const preflight = await ok.handler(
      new Request(URL_, { method: 'OPTIONS', headers: { Origin: APP } }),
    )
    assertEquals(preflight.headers.get('Access-Control-Allow-Origin'), APP)
    assertEquals(
      (await ok.handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    assertEquals((await ok.handler(post(DEACTIVATE, null))).status, 401)
    for (
      const body of [
        {},
        { action: 'delete', professional_id: PROFESSIONAL_ID },
        { action: 'deactivate', professional_id: PROFESSIONAL_ID },
        { ...DEACTIVATE, professional_id: 'nope' },
        { ...ACTIVATE, override_reason: 12 },
        { action: 'sync_signin' },
      ]
    ) {
      const error = await errorOf(await ok.handler(post(body)))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
    }
    assertEquals(ok.events, [])

    // The conseillère (professionals.view and .matching, no .manage).
    const denied = harness({
      access: professionalsAccess([
        'professionals.view',
        'professionals.matching',
      ]),
    })
    const forbidden = await errorOf(await denied.handler(post(DEACTIVATE)))
    assertEquals([forbidden.status, forbidden.code], [403, 'forbidden'])

    // The module off: the permission is gone with it.
    const off = harness({
      access: { ...professionalsAccess(MANAGE), modules: [] },
    })
    const disabled = await errorOf(await off.handler(post(DEACTIVATE)))
    assertEquals([disabled.status, disabled.code], [403, 'module_disabled'])
    assertEquals([...denied.events, ...off.events], [])
    assertEquals(
      [...denied.service.adminCalls, ...off.service.adminCalls],
      [],
    )
  })
})

Deno.test('professionals-set-status: « Fin de collaboration » → the RPC as the caller, then the ban of that provider → 200 signin_synced', async () => {
  await run(async () => {
    const { handler, user, events } = harness()
    // A profile id in the body is ignored: the account is the RPC's.
    const res = await handler(
      post({ ...DEACTIVATE, note: 'Départ', profile_id: OTHER_USER }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      status: 'inactive',
      account_change: 'disabled',
      profile_id: PROVIDER_ID,
      signin_synced: true,
    })
    assertEquals(events, ['deactivate', `ban:${PROVIDER_ID}:876000h`])
    assertEquals(user.calls.at(-1), {
      fn: 'deactivate_professional',
      args: { p_id: PROFESSIONAL_ID, p_reason_id: REASON_ID, p_note: 'Départ' },
    })
  })
})

Deno.test('professionals-set-status: a deactivation that keeps the account (or one already disabled) never calls Auth', async () => {
  await run(async () => {
    const { handler, user, service, events } = harness({
      deactivate: row('inactive', null),
    })
    const res = await handler(post({ ...DEACTIVATE, note: null }))
    assertEquals(await res.json(), {
      status: 'inactive',
      account_change: null,
      profile_id: null,
      signin_synced: true,
    })
    assertEquals(events, ['deactivate'])
    assertEquals(service.adminCalls, [])
    // A null note is not sent (the RPC's default).
    assertEquals(user.calls.at(-1)?.args, {
      p_id: PROFESSIONAL_ID,
      p_reason_id: REASON_ID,
    })
  })
})

Deno.test('professionals-set-status: a ban failure after the disable → 200 signin_synced false, reported with ids only; the deactivation stands', async () => {
  await run(async () => {
    const { handler, events } = harness({ updateUser: authDown })
    const logged = await reports(async () => {
      const res = await handler(post(DEACTIVATE))
      assertEquals(res.status, 200)
      assertEquals((await res.json()).signin_synced, false)
    })
    assertEquals(events, ['deactivate', `ban:${PROVIDER_ID}:876000h`])
    assertEquals(logged.at(-1), {
      fn: 'professionals-set-status',
      code: 'auth_ban_failed',
      ids: {
        org_id: ORG_ID,
        professional_id: PROFESSIONAL_ID,
        user_id: PROVIDER_ID,
      },
    })
  })
})

Deno.test('professionals-set-status: a reactivation that re-enables the account lifts the ban; the override reason is passed', async () => {
  await run(async () => {
    const { handler, user, events } = harness()
    const res = await handler(
      post({
        ...ACTIVATE,
        override_reason: 'Dossier complété hors application',
      }),
    )
    assertEquals(await res.json(), {
      status: 'active',
      account_change: 'enabled',
      profile_id: PROVIDER_ID,
      signin_synced: true,
    })
    assertEquals(events, ['activate', `ban:${PROVIDER_ID}:none`])
    assertEquals(user.calls.at(-1), {
      fn: 'activate_professional',
      args: {
        p_id: PROFESSIONAL_ID,
        p_override_reason: 'Dossier complété hors application',
      },
    })
  })
})

Deno.test('professionals-set-status: an activation without an account change never calls Auth; an unban failure → 200 signin_synced false, reported', async () => {
  await run(async () => {
    const plain = harness({ activate: row('active', null) })
    assertEquals(await (await plain.handler(post(ACTIVATE))).json(), {
      status: 'active',
      account_change: null,
      profile_id: null,
      signin_synced: true,
    })
    assertEquals(plain.service.adminCalls, [])
    assertEquals(plain.user.calls.at(-1)?.args, { p_id: PROFESSIONAL_ID })

    const failing = harness({ updateUser: authDown })
    const logged = await reports(async () => {
      const res = await failing.handler(post(ACTIVATE))
      assertEquals(res.status, 200)
      assertEquals(await res.json(), {
        status: 'active',
        account_change: 'enabled',
        profile_id: PROVIDER_ID,
        signin_synced: false,
      })
    })
    assertEquals(logged.map((l) => l.code), ['auth_unban_failed'])
  })
})

Deno.test('professionals-set-status: an RPC refusal → its answer (HINT as field), and Auth is never called', async () => {
  await run(async () => {
    for (
      const [error, status, code, field] of [
        [
          { code: 'P0001', message: 'Précisez la raison.', hint: 'note' },
          400,
          'invalid_request',
          'note',
        ],
        [
          {
            code: 'P0001',
            message: 'Ce dossier est déjà inactif.',
            hint: 'status',
          },
          400,
          'invalid_request',
          'status',
        ],
        [
          { code: '42501', message: 'Permission refusée' },
          403,
          'forbidden',
          undefined,
        ],
        [{ code: '22023', message: 'x' }, 400, 'invalid_request', undefined],
        [
          { code: '40001', message: 'Le dossier vient de changer.' },
          409,
          'conflict',
          undefined,
        ],
      ] as const
    ) {
      const { handler, service } = harness({ deactivate: { error } })
      const logged = await reports(async () => {
        const body = await errorOf(await handler(post(DEACTIVATE)))
        assertEquals([body.status, body.code, body.field], [
          status,
          code,
          field,
        ])
        assertEquals(body.refusal, error.code === 'P0001' ? true : undefined)
        if (error.code === 'P0001') assertEquals(body.message, error.message)
      })
      assertEquals(logged, [], `${error.code} is not reported`)
      assertEquals(service.adminCalls, [])
    }
  })
})

Deno.test('professionals-set-status: another RPC error or an unexpected answer → 500, reported; Auth never called', async () => {
  await run(async () => {
    for (
      const [route, reported] of [
        [{ error: { code: 'XX000', message: 'boom' } }, 'status_failed'],
        [{ data: [] }, 'status_invalid'],
        [{
          data: [{
            status: 'inactive',
            account_change: 'disabled',
            profile_id: null,
          }],
        }, 'status_invalid'],
      ] as const
    ) {
      const { handler, service } = harness({ deactivate: route })
      const logged = await reports(async () => {
        const error = await errorOf(await handler(post(DEACTIVATE)))
        assertEquals([error.status, error.code], [500, 'internal'])
      })
      assertEquals(logged.map((l) => l.code), [reported])
      assertEquals(service.adminCalls, [])
    }
  })
})

Deno.test('professionals-set-status: a misconfigured service client answers before any change', async () => {
  await run(async () => {
    const { handler, events } = harness({ serviceDown: true })
    assertEquals((await handler(post(DEACTIVATE))).status, 500)
    assertEquals(events, [])
  })
})

Deno.test('professionals-set-status: « Réessayer » (sync_signin) bans a disabled account, unbans an active one, does nothing without one', async () => {
  await run(async () => {
    const disabled = harness()
    assertEquals(await (await disabled.handler(post(SYNC))).json(), {
      account_status: 'disabled',
      signin_synced: true,
    })
    assertEquals(disabled.events, ['account', `ban:${PROVIDER_ID}:876000h`])
    assertEquals(disabled.user.calls.at(-1), {
      fn: 'get_professional_account_status',
      args: { p_id: PROFESSIONAL_ID },
    })

    const active = harness({
      account: {
        data: [{ profile_id: PROVIDER_ID, account_status: 'active' }],
      },
    })
    assertEquals(await (await active.handler(post(SYNC))).json(), {
      account_status: 'active',
      signin_synced: true,
    })
    assertEquals(active.events, ['account', `ban:${PROVIDER_ID}:none`])

    const none = harness({ account: { data: [] } })
    assertEquals(await (await none.handler(post(SYNC))).json(), {
      account_status: null,
      signin_synced: true,
    })
    assertEquals(none.service.adminCalls, [])
  })
})

Deno.test('professionals-set-status: sync_signin failures: Auth down → signin_synced false, reported; a refused read → its answer', async () => {
  await run(async () => {
    const down = harness({ updateUser: authDown })
    const logged = await reports(async () => {
      assertEquals(await (await down.handler(post(SYNC))).json(), {
        account_status: 'disabled',
        signin_synced: false,
      })
    })
    assertEquals(logged.map((l) => l.code), ['auth_sync_failed'])

    const refused = harness({
      account: { error: { code: '42501', message: 'Permission refusée' } },
    })
    const error = await errorOf(await refused.handler(post(SYNC)))
    assertEquals([error.status, error.code], [403, 'forbidden'])
    assertEquals(refused.service.adminCalls, [])

    const odd = harness({
      account: {
        data: [{ profile_id: PROVIDER_ID, account_status: 'banned' }],
      },
    })
    const oddLogged = await reports(async () => {
      assertEquals((await odd.handler(post(SYNC))).status, 500)
    })
    assertEquals(oddLogged.map((l) => l.code), ['account_invalid'])
    assertEquals(odd.service.adminCalls, [])
  })
})
