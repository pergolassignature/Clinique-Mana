import { assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeDocumenso } from '../_shared/testing/fake-documenso.ts'
import { fakeSigningDb } from '../_shared/testing/fake-signing-db.ts'
import { fakeSupabase } from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { withEnv } from '../_shared/testing/env.ts'
import { accessFixture } from '../_shared/testing/email-fixtures.ts'
import {
  DOCUMENSO_KEY,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/signing-test-connection'

function setup(
  options: { permissions?: string[]; apiKey?: string | null } = {},
) {
  const clock = fixedClock('2026-10-08T12:00:00.000Z')
  const fake = fakeDocumenso()
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    apiKey: options.apiKey,
  })
  const service = fakeSupabase({ rpc: db.rpc })
  const user = fakeSupabase({
    user: { id: 'u1' },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(
            options.permissions ??
              ['settings.view', 'settings.integrations_manage'],
          ),
          org_id: SIGNING_ORG,
        },
      },
    },
  })
  const deps: Deps = {
    env: () => undefined,
    fetch: fake.fetch,
    now: clock.now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { fake, service, handler: createHandler(deps) }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)

const post = (token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

Deno.test('signing-test-connection: Documenso answers → { ok: true }', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post())
    assertEquals([res.status, await res.json()], [200, { ok: true }])
    assertEquals(s.fake.calls[0].headers.get('Authorization'), DOCUMENSO_KEY)
  })
})

Deno.test('signing-test-connection: a 401 from Documenso → { ok: false, status: 401 }, neither the key nor the URL in the answer', async () => {
  await run(async () => {
    const s = setup({ apiKey: 'local-dev-wrong-key' })
    const res = await s.handler(post())
    const text = await res.text()
    assertEquals([res.status, JSON.parse(text)], [200, {
      ok: false,
      status: 401,
    }])
    assertFalse(text.includes('local-dev-wrong-key'))
    assertFalse(text.includes('host.docker.internal'))
  })
})

Deno.test('signing-test-connection: nothing answers → 502 provider_error, no URL in the answer', async () => {
  await run(async () => {
    const s = setup()
    const broken = createHandler({
      env: () => undefined,
      fetch: () =>
        Promise.reject(
          new TypeError('connect ECONNREFUSED host.docker.internal'),
        ),
      now: () => new Date(),
      serviceClient: () => s.service.client,
      userClient: () =>
        fakeSupabase({
          user: { id: 'u1' },
          rpc: {
            get_my_access: {
              data: {
                ...accessFixture(['settings.integrations_manage']),
                org_id: SIGNING_ORG,
              },
            },
          },
        }).client,
    })
    const res = await broken(post())
    const text = await res.text()
    assertEquals(res.status, 502)
    assertEquals(JSON.parse(text).error.code, 'provider_error')
    assertFalse(text.includes('host.docker.internal'))
  })
})

Deno.test('signing-test-connection: no URL or key → 503 not_configured; no permission → 403; no token → 401', async () => {
  await run(async () => {
    let res = await setup({ apiKey: null }).handler(post())
    assertEquals([res.status, (await res.json()).error.code], [
      503,
      'not_configured',
    ])
    const s = setup({ permissions: ['settings.view'] })
    res = await s.handler(post())
    assertEquals([res.status, (await res.json()).error.code], [
      403,
      'forbidden',
    ])
    assertEquals(s.service.calls.length, 0)
    res = await setup().handler(post(null))
    assertEquals(res.status, 401)
  })
})
