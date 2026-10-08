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
  deployedReach,
  DOCUMENSO_KEY,
  LOCAL_APP_URL,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/signing-test-connection'
/** Local dev: the fake at host.docker.internal is allowed (P3-34). */
const localEnv = (key: string) => key === 'APP_URL' ? LOCAL_APP_URL : undefined

function setup(
  options: {
    permissions?: string[]
    apiKey?: string | null
    /** The stored address (default: the fake's, host.docker.internal). */
    baseUrl?: string
    env?: Deps['env']
    resolveDns?: Deps['resolveDns']
    /** Wraps the fake Documenso's fetch. */
    fetch?: (fake: typeof fetch) => typeof fetch
  } = {},
) {
  const clock = fixedClock('2026-10-08T12:00:00.000Z')
  const fake = fakeDocumenso(
    options.baseUrl ? { baseUrl: options.baseUrl } : {},
  )
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
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
    env: options.env ?? localEnv,
    fetch: options.fetch ? options.fetch(fake.fetch) : fake.fetch,
    resolveDns: options.resolveDns,
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
      env: localEnv,
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

// ---------------------------------------------------------------------------
// Reach (P3-34: SSRF and key exfiltration)
// ---------------------------------------------------------------------------
/** A deployed project: `APP_URL` is not local. */
const deployedEnv = (key: string) =>
  key === 'APP_URL' ? 'https://app.cliniquemana.ca' : undefined
const PUBLIC_BASE = 'https://sign.cliniquemana.test'

Deno.test('signing-test-connection: deployed, a public name → the fake Documenso answers { ok: true }', async () => {
  await run(async () => {
    const reach = deployedReach({ A: ['93.184.215.14'] })
    const s = setup({
      baseUrl: PUBLIC_BASE,
      env: deployedEnv,
      resolveDns: reach.resolveDns,
    })
    const res = await s.handler(post())
    assertEquals([res.status, await res.json()], [200, { ok: true }])
    assertEquals(reach.lookups, [
      'A sign.cliniquemana.test',
      'AAAA sign.cliniquemana.test',
    ])
  })
})

Deno.test('signing-test-connection: deployed, a name resolving to a private address → 502, nothing sent', async () => {
  await run(async () => {
    for (
      const records of [{ A: ['10.0.0.5'] }, { AAAA: ['::ffff:127.0.0.1'] }]
    ) {
      const reach = deployedReach(records)
      const s = setup({
        baseUrl: PUBLIC_BASE,
        env: deployedEnv,
        resolveDns: reach.resolveDns,
      })
      const res = await s.handler(post())
      const text = await res.text()
      assertEquals(res.status, 502)
      assertEquals(JSON.parse(text).error.code, 'provider_error')
      assertEquals(s.fake.calls.length, 0)
      assertFalse(text.includes(DOCUMENSO_KEY))
      assertFalse(text.includes('sign.cliniquemana.test'))
    }
  })
})

Deno.test('signing-test-connection: deployed, the local fake address → 502 without a lookup or a request', async () => {
  await run(async () => {
    const reach = deployedReach()
    const s = setup({ env: deployedEnv, resolveDns: reach.resolveDns })
    const res = await s.handler(post())
    assertEquals(res.status, 502)
    assertEquals([s.fake.calls.length, reach.lookups.length], [0, 0])
  })
})

Deno.test('signing-test-connection: a redirect is not followed → 502, the key never leaves for the Location', async () => {
  await run(async () => {
    const reach = deployedReach({ A: ['93.184.215.14'] })
    const sent: {
      url: string
      redirect: RequestRedirect
      auth: string | null
    }[] = []
    const s = setup({
      baseUrl: PUBLIC_BASE,
      env: deployedEnv,
      resolveDns: reach.resolveDns,
      fetch: () => (input, init) => {
        const req = new Request(input, init)
        sent.push({
          url: req.url,
          redirect: req.redirect,
          auth: req.headers.get('Authorization'),
        })
        return Promise.resolve(
          Response.redirect('https://collector.evil.test/steal', 302),
        )
      },
    })
    const res = await s.handler(post())
    const text = await res.text()
    assertEquals(res.status, 502)
    assertEquals(JSON.parse(text).error.code, 'provider_error')
    assertEquals(sent, [{
      url: `${PUBLIC_BASE}/api/v2/document?perPage=1`,
      redirect: 'manual',
      auth: DOCUMENSO_KEY,
    }])
    assertFalse(text.includes('evil.test'))
  })
})
