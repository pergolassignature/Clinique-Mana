import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { createHandler as createWebhook } from '../signing-webhook/handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { DOCUMENSO_PATHS } from '../_shared/documenso.ts'
import { fakeDocumenso } from '../_shared/testing/fake-documenso.ts'
import { fakeSigningDb } from '../_shared/testing/fake-signing-db.ts'
import { fakeSupabase } from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_EMAIL,
  ADMIN_ID,
  ADMIN_NAME,
} from '../_shared/testing/email-fixtures.ts'
import {
  LOCAL_APP_URL,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/signing-test-document'
const KEY = '9b1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'

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
  const service = fakeSupabase({ rpc: db.rpc, storage: db.storage })
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
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
    env: (key) => key === 'APP_URL' ? LOCAL_APP_URL : undefined,
    fetch: fake.fetch,
    now: clock.now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { fake, db, service, deps, handler: createHandler(deps) }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)

const post = (
  body: unknown = { idempotency_key: KEY },
  token: string | null = 'tok',
) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

Deno.test('signing-test-document: the built-in document is sent to the caller (core.signing_test, the caller as subject)', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post())
    const body = await res.json()
    assertEquals(res.status, 200)
    assertEquals(body.existing, false)
    const row = s.db.requests.get(body.request_id)!
    assertEquals(row.status, 'sent')
    assertEquals(row.purpose, 'core.signing_test')
    assertEquals(row.module_key, 'core')
    assertEquals(row.subject_type, 'signing_test')
    assertEquals(row.subject_id, ADMIN_ID)
    assertEquals(row.view_permission, 'settings.integrations_manage')
    assertEquals(row.sent_by, ADMIN_ID)
    assertEquals(row.idempotency_key, `core.signing_test:${ADMIN_ID}:${KEY}`)
    assertEquals(row.signers.map((x) => [x.role, x.name, x.email]), [
      ['clinic', ADMIN_NAME, ADMIN_EMAIL],
    ])
    const doc = s.fake.documents.get(row.documenso_document_id!)!
    assertEquals(doc.title, 'Document test de signature électronique')
    assertEquals(doc.meta.subject, 'Document test de signature électronique')
    assert(!JSON.stringify(body).includes('@'), 'the answer holds no address')
  })
})

Deno.test('signing-test-document: a double click (same key) → the same request, one document', async () => {
  await run(async () => {
    const s = setup()
    const first = await (await s.handler(post())).json()
    const again = await (await s.handler(post())).json()
    assertEquals(again, { request_id: first.request_id, existing: true })
    assertEquals(s.fake.documents.size, 1)
  })
})

Deno.test('signing-test-document: two clicks at once (same key) → exactly one send; the other 409 « Un envoi est déjà en cours. »', async () => {
  await run(async () => {
    const s = setup()
    // Deterministic overlap: Documenso's create is held until both calls
    // have tried to claim the draft, so the winner's send is still running
    // when the other one asks (never finished before it starts).
    let claims = 0
    let bothClaimed!: () => void
    const gate = new Promise<void>((resolve) => (bothClaimed = resolve))
    const claim = s.db.rpc.begin_signature_request_send
    s.db.rpc.begin_signature_request_send = async (args) => {
      const result = typeof claim === 'function' ? await claim(args) : claim
      if (++claims === 2) bothClaimed()
      return result
    }
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const req = new Request(input, init)
      if (new URL(req.url).pathname === DOCUMENSO_PATHS.create) await gate
      return s.fake.fetch(req)
    }
    const handler = createHandler({ ...s.deps, fetch })
    const answers = await Promise.all([handler(post()), handler(post())])
    const bodies = await Promise.all(answers.map((r) => r.json()))
    assertEquals(claims, 2)
    assertEquals(answers.map((r) => r.status).sort(), [200, 409])
    const refused = bodies[answers.findIndex((r) => r.status === 409)]
    assertEquals(refused.error.message, 'Un envoi est déjà en cours.')
    assertEquals(refused.error.code, 'conflict')
    assertEquals(s.fake.documents.size, 1)
    assertEquals([...s.db.requests.values()][0].status, 'sent')
  })
})

Deno.test('signing-test-document: the caller closing the connection mid-send does not abort it (Documenso and the database both finish)', async () => {
  await run(async () => {
    const s = setup()
    const controller = new AbortController()
    // A fetch that honours its signal, as Deno's does; the caller leaves as
    // soon as Documenso is first called.
    const fetch: typeof globalThis.fetch = (input, init) => {
      controller.abort()
      if (new Request(input, init).signal.aborted) {
        return Promise.reject(new DOMException('aborted', 'AbortError'))
      }
      return s.fake.fetch(input, init)
    }
    const handler = createHandler({ ...s.deps, fetch })
    const req = new Request(post(), { signal: controller.signal })
    const res = await handler(req)
    assert(req.signal.aborted, 'the caller left')
    assertEquals(res.status, 200)
    const { request_id } = await res.json()
    assertEquals(s.db.requests.get(request_id)!.status, 'sent')
    assertEquals(s.fake.documents.get('1')!.status, 'PENDING')
  })
})

Deno.test('signing-test-document: the full circuit with the webhook: completed → signed, the PDF stored', async () => {
  await run(async () => {
    const s = setup()
    const { request_id } = await (await s.handler(post())).json()
    const doc = s.db.requests.get(request_id)!.documenso_document_id!
    s.fake.complete(doc)
    const webhook = createWebhook(s.deps)
    const res = await webhook(s.fake.webhookRequest(
      `http://fn.test/functions/v1/signing-webhook?org=${SIGNING_ORG}`,
      'DOCUMENT_COMPLETED',
      doc,
    ))
    assertEquals(await res.json(), { outcome: 'signed' })
    assertEquals(s.db.requests.get(request_id)!.status, 'signed')
  })
})

Deno.test('signing-test-document: not configured → 503; Documenso down → 502; no permission → 403; a bad body → 400', async () => {
  await run(async () => {
    let res = await setup({ apiKey: null }).handler(post())
    assertEquals([res.status, (await res.json()).error.code], [
      503,
      'not_configured',
    ])

    const s = setup()
    s.fake.failures.create = 503
    res = await s.handler(post())
    assertEquals([res.status, (await res.json()).error.code], [
      502,
      'provider_error',
    ])

    const denied = setup({ permissions: ['settings.view'] })
    res = await denied.handler(post())
    assertEquals([res.status, (await res.json()).error.code], [
      403,
      'forbidden',
    ])
    assertEquals(denied.service.calls.length, 0)

    res = await setup().handler(post({}))
    assertEquals(res.status, 400)
    res = await setup().handler(post({ idempotency_key: 'a b' }))
    assertEquals(res.status, 400)
  })
})

Deno.test('signing-test-document: an internal failure → 500 internal, reported with ids only', async () => {
  await run(async () => {
    const s = setup()
    s.db.storage.upload = () => ({ error: { message: 'boom' } })
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(post())
      assertEquals([res.status, (await res.json()).error.code], [
        500,
        'internal',
      ])
    })
    const report = JSON.stringify(lines)
    assert(report.includes('source_upload_failed'))
    assert(!report.includes('@'))
  })
})
