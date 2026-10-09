import { assertEquals, assertStringIncludes } from '@std/assert'
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

const URL_ = 'http://fn.test/functions/v1/users-delete'
const TARGET = '00000000-0000-4000-8000-0000000000b2'
const TARGET_EMAIL = 'conseillere@mana.test'
const TARGET_NAME = 'Conseillère Test'

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
  deleteAccount?: RpcRoute
  deleteUser?: AdminRoute
  limitAllowed?: boolean
} = {}) {
  /** Both clients' writes, in one order. */
  const events: string[] = []
  const deleteAccount = opts.deleteAccount ?? { data: 'deleted' }
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: accessFixture(opts.permissions ?? ['users.manage', 'users.view']),
      },
      delete_staff_account: async (args) => {
        events.push('delete_staff_account')
        return typeof deleteAccount === 'function'
          ? await deleteAccount(args)
          : deleteAccount
      },
    },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: () => {
        events.push('rate_limit')
        const allowed = opts.limitAllowed ?? true
        return {
          data: [{ allowed, hits: 1, retry_after_seconds: allowed ? 0 : 600 }],
        }
      },
    },
    admin: {
      deleteUser: (...args) => {
        events.push('auth_delete')
        return opts.deleteUser?.(...args) ?? { data: { user: null } }
      },
    },
  })
  const deps: Deps = {
    env: () => undefined,
    fetch: fakeFetch({}).fetch,
    now: fixedClock('2026-10-09T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), user, service, events }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
  }, fn)

async function errorOf(res: Response) {
  const body = await res.json()
  return {
    status: res.status,
    ...body.error,
    account_removed: body.account_removed,
  }
}

const authDown = () => ({
  error: Object.assign(new Error(`down for ${TARGET_EMAIL}`), {
    status: 500,
    code: 'unexpected',
  }),
})

Deno.test('users-delete: rate limit, then delete_staff_account as the caller, then the Auth deletion → 200', async () => {
  await run(async () => {
    const { handler, user, service, events } = harness()
    const res = await handler(post({ user_id: TARGET }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { status: 'deleted' })
    assertEquals(events, ['rate_limit', 'delete_staff_account', 'auth_delete'])
    assertEquals(user.calls[1], {
      fn: 'delete_staff_account',
      args: { p_user_id: TARGET },
    })
    assertEquals(service.adminCalls, [{ method: 'deleteUser', args: [TARGET] }])
    // The limit is per caller, in the caller's org (never a body value).
    assertEquals(service.calls.map((c) => c.fn), ['consume_rate_limit'])
    assertEquals(service.calls[0].args.p_bucket, 'users.delete_user')
  })
})

Deno.test('users-delete: any org or actor in the body is ignored', async () => {
  await run(async () => {
    const { handler, user } = harness()
    const res = await handler(
      post({
        user_id: TARGET,
        org_id: '00000000-0000-4000-8000-0000000000ff',
        actor: TARGET,
      }),
    )
    assertEquals(res.status, 200)
    assertEquals(user.calls[1].args, { p_user_id: TARGET })
  })
})

Deno.test('users-delete: already_deleted (a retry) runs the Auth deletion again → 200', async () => {
  await run(async () => {
    const { handler, events } = harness({
      deleteAccount: { data: 'already_deleted' },
    })
    const res = await handler(post({ user_id: TARGET }))
    assertEquals(res.status, 200)
    assertEquals(events, ['rate_limit', 'delete_staff_account', 'auth_delete'])
  })
})

Deno.test('users-delete: Auth answers « not found » → done (200), nothing reported', async () => {
  await run(async () => {
    const { handler } = harness({
      deleteUser: () => ({
        error: Object.assign(new Error('User not found'), {
          status: 404,
          code: 'user_not_found',
        }),
      }),
    })
    const logged = await captureConsole('error', async () => {
      assertEquals((await handler(post({ user_id: TARGET }))).status, 200)
    })
    assertEquals(logged, [])
  })
})

Deno.test('users-delete: an Auth failure after the app rows went → 502 provider_error, account_removed, reported with ids only; a retry finishes', async () => {
  await run(async () => {
    let authFails = true
    let rpcCalls = 0
    const { handler, events } = harness({
      deleteAccount: () => {
        rpcCalls += 1
        return { data: rpcCalls === 1 ? 'deleted' : 'already_deleted' }
      },
      deleteUser: () => authFails ? authDown() : { data: { user: null } },
    })
    const logged = await captureConsole('error', async () => {
      const error = await errorOf(await handler(post({ user_id: TARGET })))
      assertEquals(
        [error.status, error.code, error.account_removed],
        [502, 'provider_error', true],
      )
    })
    assertEquals(logged.length, 1)
    assertEquals(JSON.parse(String(logged[0][0])), {
      fn: 'users-delete',
      code: 'auth_delete_failed',
      ids: { org_id: ORG_ID, user_id: TARGET },
    })

    authFails = false
    const retry = await handler(post({ user_id: TARGET }))
    assertEquals(retry.status, 200)
    assertEquals(events, [
      'rate_limit',
      'delete_staff_account',
      'auth_delete',
      'rate_limit',
      'delete_staff_account',
      'auth_delete',
    ])
  })
})

Deno.test('users-delete: no address, name or provider message reaches a log or the answer', async () => {
  await run(async () => {
    const { handler } = harness({ deleteUser: authDown })
    let text = ''
    const logged = await captureConsole('error', async () => {
      text = await (await handler(post({ user_id: TARGET }))).text()
    })
    const all = text + logged.map((l) => l.map(String).join(' ')).join('\n')
    for (const secret of [TARGET_EMAIL, TARGET_NAME, 'down for']) {
      assertEquals(all.includes(secret), false, secret)
    }
    assertStringIncludes(all, TARGET) // ids are fine
  })
})

Deno.test('users-delete: an RPC refusal → its answer, and Auth is never called', async () => {
  await run(async () => {
    const linked =
      "Ce compte est lié au dossier professionnel de Paule Pro. Désactivez d'abord ce dossier dans Professionnels (fin de la collaboration)."
    for (
      const [error, status, code] of [
        [
          { code: 'P0001', message: "Désactivez d'abord le compte." },
          400,
          'invalid_request',
        ],
        [
          {
            code: 'P0001',
            message: 'Vous ne pouvez pas supprimer votre propre compte.',
          },
          400,
          'invalid_request',
        ],
        [
          { code: 'P0001', message: 'Utilisateur introuvable.' },
          400,
          'invalid_request',
        ],
        [{ code: 'P0001', message: linked }, 400, 'invalid_request'],
        [
          { code: '42501', message: 'Permission refusée : users.manage' },
          403,
          'forbidden',
        ],
        [
          { code: '22023', message: 'Utilisateur manquant' },
          400,
          'invalid_request',
        ],
      ] as const
    ) {
      const { handler, service } = harness({ deleteAccount: { error } })
      const logged = await captureConsole('error', async () => {
        const body = await errorOf(await handler(post({ user_id: TARGET })))
        assertEquals([body.status, body.code], [status, code])
        // Only a P0001 is flagged a refusal (its French message is shown).
        assertEquals(body.refusal, error.code === 'P0001' ? true : undefined)
        if (error.code === 'P0001') assertEquals(body.message, error.message)
      })
      assertEquals(logged, [], 'an expected refusal is not reported')
      assertEquals(service.adminCalls, [])
    }
  })
})

Deno.test('users-delete: another RPC error or an unexpected answer → 500, reported; Auth never called', async () => {
  await run(async () => {
    for (
      const [route, reported] of [
        [{ error: { code: 'XX000', message: 'boom' } }, 'delete_failed'],
        [{ data: 'maybe' }, 'delete_unexpected'],
      ] as const
    ) {
      const { handler, service } = harness({ deleteAccount: route })
      const logged = await captureConsole('error', async () => {
        const error = await errorOf(await handler(post({ user_id: TARGET })))
        assertEquals([error.status, error.code], [500, 'internal'])
      })
      assertEquals(JSON.parse(String(logged.at(-1)?.[0])).code, reported)
      assertEquals(service.adminCalls, [])
    }
  })
})

Deno.test('users-delete: no users.manage → 403; no token → 401; a bad body → 400; a GET → 405; nothing changed', async () => {
  await run(async () => {
    const denied = harness({ permissions: ['users.view'] })
    const error = await errorOf(await denied.handler(post({ user_id: TARGET })))
    assertEquals([error.status, error.code], [403, 'forbidden'])
    assertEquals(
      (await denied.handler(post({ user_id: TARGET }, null))).status,
      401,
    )
    assertEquals(denied.events, [])

    for (const body of [{}, { user_id: 'nope' }, { user_id: 42 }]) {
      const { handler, events } = harness()
      const bad = await errorOf(await handler(post(body)))
      assertEquals([bad.status, bad.code], [400, 'invalid_request'])
      assertEquals(events, [])
    }

    const { handler, events } = harness()
    assertEquals((await handler(new Request(URL_))).status, 405)
    assertEquals(events, [])
  })
})

Deno.test("users-delete: the caller's limit → 429 with Retry-After; nothing deleted", async () => {
  await run(async () => {
    const { handler, events, service } = harness({ limitAllowed: false })
    const res = await handler(post({ user_id: TARGET }))
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '600')
    assertEquals((await res.json()).error.code, 'rate_limited')
    assertEquals(events, ['rate_limit'])
    assertEquals(service.adminCalls, [])
  })
})

Deno.test('users-delete: CORS preflight is answered without auth', async () => {
  await run(async () => {
    const { handler, events } = harness()
    const res = await handler(
      new Request(URL_, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
    )
    assertEquals(res.status < 300, true)
    await res.body?.cancel()
    assertEquals(events, [])
  })
})
