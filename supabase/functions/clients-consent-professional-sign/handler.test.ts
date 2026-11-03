import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { DOCUMENSO_PATHS } from '../_shared/documenso.ts'
import { fakeDocumenso } from '../_shared/testing/fake-documenso.ts'
import { fakeSigningDb } from '../_shared/testing/fake-signing-db.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { withEnv } from '../_shared/testing/env.ts'
import { accessFixture, ADMIN_ID } from '../_shared/testing/email-fixtures.ts'
import {
  LOCAL_APP_URL,
  sentRequest,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/clients-consent-professional-sign'
const REQUEST_ID = '00000000-0000-4000-8000-0000000000c1'
const PUBLIC_URL = 'http://127.0.0.1:55390'
const RPC = 'prepare_my_client_consent_signature_for_service'

function setup(
  options: {
    permissions?: string[]
    modules?: string[]
    prepare?: RpcRoute
  } = {},
) {
  const clock = fixedClock('2026-10-28T12:00:00.000Z')
  const fake = fakeDocumenso()
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    modules: ['clients'],
  })
  const service = fakeSupabase({
    rpc: {
      ...db.rpc,
      [RPC]: options.prepare ?? { data: { state: 'waiting' } },
    },
    storage: db.storage,
  })
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(options.permissions ?? ['clients.self']),
          org_id: SIGNING_ORG,
          modules: options.modules ?? ['clients'],
        },
      },
    },
  })
  const env: Record<string, string | undefined> = {
    APP_URL: LOCAL_APP_URL,
    DOCUMENSO_PUBLIC_URL: PUBLIC_URL,
  }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: fake.fetch,
    now: clock.now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { fake, db, service, handler: createHandler(deps) }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)

const post = (b: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    },
    body: JSON.stringify(b),
  })

const consentOf = {
  purpose: 'clients.consent',
  module_key: 'clients',
  subject_type: 'client_consent_request',
  subject_id: REQUEST_ID,
}

Deno.test('clients-consent-professional-sign: before the client has signed, « en attente » and nothing asked of Documenso', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post({ request_id: REQUEST_ID }))
    const answer = await res.json()
    assertEquals(res.status, 200)
    assertEquals(answer, { state: 'waiting' })
    assertEquals(
      s.service.calls.filter((c) => c.fn === RPC).map((c) => c.args),
      [{
        p_org_id: SIGNING_ORG,
        p_actor: ADMIN_ID,
        p_request_id: REQUEST_ID,
      }],
    )
    assertEquals(s.fake.calls.length, 0, 'Documenso is not touched')
  })
})

Deno.test('clients-consent-professional-sign: she resumes the envelope with her own token, answered once, never cached', async () => {
  await run(async () => {
    let resume: Record<string, unknown> = {}
    const s = setup({
      prepare: () => ({ data: { state: 'resume', ...resume } }),
    })
    const out = await sentRequest(s.fake, s.db, consentOf)
    resume = {
      org_id: SIGNING_ORG,
      request_id: out.id,
      envelope_id: out.envelope_id,
      recipient_id: out.signers[0].recipient_id,
    }
    const before = s.fake.documents.size
    const res = await s.handler(post({ request_id: REQUEST_ID }))
    const answer = await res.json()
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    assertEquals(answer.state, 'ready')
    assertEquals(answer.request_id, out.id)
    assertEquals(
      answer.token,
      s.fake.documents.get(out.envelope_id!)!.recipients[0].token,
    )
    assertEquals(answer.host, PUBLIC_URL)
    assertEquals(
      answer.signing_url,
      `${PUBLIC_URL}/sign/${encodeURIComponent(answer.token)}`,
    )
    assertEquals(s.fake.documents.size, before, 'no second envelope')
    assert(
      !s.fake.calls.some((c) =>
        new URL(c.url).pathname === DOCUMENSO_PATHS.distribute ||
        new URL(c.url).pathname === DOCUMENSO_PATHS.redistribute
      ),
      'nothing emailed: she signs in the app',
    )
  })
})

Deno.test('clients-consent-professional-sign: a refusal passes as written, with its HINT as the field', async () => {
  await run(async () => {
    const s = setup({
      prepare: {
        error: {
          code: 'P0001',
          message: 'Vous avez déjà signé ce consentement.',
          hint: 'signed',
        },
      },
    })
    const res = await s.handler(post({ request_id: REQUEST_ID }))
    const answer = await res.json()
    assertEquals(res.status, 400)
    assertEquals(answer.error.message, 'Vous avez déjà signé ce consentement.')
    assertEquals(answer.error.refusal, true)
    assertEquals(answer.error.field, 'signed')
    assertEquals(s.fake.calls.length, 0, 'Documenso is not touched')
  })
})

Deno.test('clients-consent-professional-sign: without clients.self, or with the module off, nothing is prepared', async () => {
  await run(async () => {
    const noPermission = setup({ permissions: ['clients.view'] })
    assertEquals(
      (await noPermission.handler(post({ request_id: REQUEST_ID }))).status,
      403,
    )
    assertEquals(
      noPermission.service.calls.filter((c) => c.fn === RPC).length,
      0,
    )
    const noModule = setup({ modules: ['professionals'] })
    assert(
      [403, 503].includes(
        (await noModule.handler(post({ request_id: REQUEST_ID }))).status,
      ),
      'the module gate answers before anything is prepared',
    )
    assertEquals(noModule.service.calls.filter((c) => c.fn === RPC).length, 0)
  })
})

Deno.test('clients-consent-professional-sign: GET is refused, and the body must name one request', async () => {
  await run(async () => {
    const s = setup()
    assertEquals(
      (await s.handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    assertEquals((await s.handler(post({}))).status, 400)
    assertEquals((await s.handler(post({ request_id: 'nope' }))).status, 400)
    assertEquals(
      (await s.handler(post({ request_id: REQUEST_ID, extra: 1 }))).status,
      400,
    )
    assertEquals(s.service.calls.filter((c) => c.fn === RPC).length, 0)
  })
})
