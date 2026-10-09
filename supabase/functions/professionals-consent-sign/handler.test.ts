import { assert, assertEquals } from '@std/assert'
import { createHandler, redirectUrl, returnBase } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { DOCUMENSO_PATHS } from '../_shared/documenso.ts'
import type { PdfDocument } from '../_shared/pdf/model.ts'
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
  SIGNER_EMAIL,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/professionals-consent-sign'
const PRO = '00000000-0000-4000-8000-0000000000b1'
const VERSION_ID = '00000000-0000-4000-8000-0000000000e2'
const KEY = '9b1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const REQUEST_KEY = `professionals.image_consent:${PRO}:${KEY}`
const PUBLIC_URL = 'http://127.0.0.1:55390'

const body: PdfDocument = {
  title: 'Consentement au droit à l’image',
  footer: { text: 'Consentement' },
  blocks: [
    {
      type: 'paragraph',
      runs: [{
        text: 'J’autorise {{clinic.name}}, {{professional.full_name}}.',
      }],
    },
    {
      type: 'signaturePage',
      signers: [{ role: 'professional', label: '{{professional.full_name}}' }],
    },
  ],
}
const variable = (path: string, label: string) => ({
  path,
  label,
  sample: label,
  required: true,
  kind: 'text',
})
const version = {
  id: VERSION_ID,
  module_key: 'professionals',
  view_permission: 'professionals.view',
  body,
  variables: [
    variable('clinic.name', 'Nom de la clinique'),
    variable('professional.full_name', 'Nom du professionnel'),
  ],
  signers: [
    { role: 'professional', label: 'Professionnel', order: 1, required: true },
  ],
  email_subject: 'Votre consentement au droit à l’image pour {{clinic.name}}',
  email_message: 'Bonjour',
}

const prepared = () => ({
  professional_id: PRO,
  idempotency_key: REQUEST_KEY,
  template_version_id: VERSION_ID,
  title: 'Consentement au droit à l’image — Ana Gagnon',
  values: { professional: { full_name: 'Ana Gagnon' } },
  signers: [{
    role: 'professional',
    name: 'Ana Gagnon',
    email: SIGNER_EMAIL,
    order: 1,
  }],
})

function setup(
  options: {
    permissions?: string[]
    modules?: string[]
    prepare?: RpcRoute
    publicUrl?: string
  } = {},
) {
  const clock = fixedClock('2026-10-09T12:00:00.000Z')
  const fake = fakeDocumenso()
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    modules: ['professionals'],
    versions: { [VERSION_ID]: version },
  })
  const service = fakeSupabase({
    rpc: {
      ...db.rpc,
      prepare_my_image_consent: options.prepare ?? { data: prepared() },
    },
    storage: db.storage,
  })
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(options.permissions ?? ['professionals.self']),
          org_id: SIGNING_ORG,
          modules: options.modules ?? ['professionals'],
        },
      },
    },
  })
  const env: Record<string, string | undefined> = {
    APP_URL: LOCAL_APP_URL,
    DOCUMENSO_PUBLIC_URL: options.publicUrl ?? PUBLIC_URL,
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

const start = (over: Record<string, unknown> = {}) =>
  post({ action: 'start', idempotency_key: KEY, ...over })

const consentOf = {
  purpose: 'professionals.image_consent',
  module_key: 'professionals',
  subject_type: 'professional',
  subject_id: PRO,
}

Deno.test('professionals-consent-sign: start → a request sent without an email, her signing token answered once, never cached', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(start({ return_step: 'revision' }))
    const answer = await res.json()
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'prepare_my_image_consent')
        .map((c) => c.args),
      [{ p_actor: ADMIN_ID, p_action: 'start', p_idempotency_key: KEY }],
    )
    const row = s.db.requests.get(answer.request_id)!
    assertEquals(row.status, 'sent')
    assertEquals(row.purpose, 'professionals.image_consent')
    assertEquals(row.view_permission, 'professionals.view')
    assertEquals(row.idempotency_key, REQUEST_KEY)
    const doc = s.fake.documents.get(row.envelope_id!)!
    assertEquals(doc.meta.distributionMethod, 'NONE', 'no email')
    assertEquals(
      doc.meta.redirectUrl,
      `${LOCAL_APP_URL}/mon-profil/questionnaire?etape=revision&consentement=signe`,
    )
    const token = doc.recipients[0].token
    assertEquals(answer.token, token)
    assertEquals(
      answer.host,
      PUBLIC_URL,
      "locally, the browser's address of the fake",
    )
    assertEquals(answer.signing_url, `${PUBLIC_URL}/sign/${token}`)
    assert(!JSON.stringify(answer).includes('@'), 'no address in the answer')
  })
})

Deno.test('professionals-consent-sign: her open request is resumed (its token read again), never a second one', async () => {
  await run(async () => {
    let resume: Record<string, unknown> | null = null
    const s = setup({ prepare: () => ({ data: { resume } }) })
    const old = await sentRequest(s.fake, s.db, {
      ...consentOf,
      idempotency_key: REQUEST_KEY,
    })
    resume = {
      request_id: old.id,
      envelope_id: old.envelope_id,
      recipient_id: old.signers[0].recipient_id,
    }
    const before = s.fake.documents.size
    const res = await s.handler(start())
    const answer = await res.json()
    assertEquals(res.status, 200)
    assertEquals(answer.request_id, old.id)
    assertEquals(
      answer.token,
      s.fake.documents.get(old.envelope_id!)!.recipients[0].token,
    )
    assertEquals(s.fake.documents.size, before, 'no new envelope')
    assert(
      !s.fake.calls.some((c) =>
        new URL(c.url).pathname === DOCUMENSO_PATHS.distribute ||
        new URL(c.url).pathname === DOCUMENSO_PATHS.redistribute
      ),
      'nothing emailed, nothing sent again',
    )
  })
})

Deno.test('professionals-consent-sign: a double click (the same key) answers the same request', async () => {
  await run(async () => {
    let resume: Record<string, unknown> | null = null
    let calls = 0
    const s = setup({
      prepare: () => (++calls > 1 && resume
        ? { data: { resume } }
        : { data: prepared() }),
    })
    const first = await (await s.handler(start())).json()
    const row = s.db.requests.get(first.request_id)!
    resume = {
      request_id: row.id,
      envelope_id: row.envelope_id,
      recipient_id: row.signers[0].recipient_id,
    }
    const again = await (await s.handler(start())).json()
    assertEquals(again.request_id, first.request_id)
    assertEquals(again.token, first.token)
    assertEquals(s.fake.documents.size, 1)
  })
})

Deno.test('professionals-consent-sign: the redirect goes back to the asking page only when ALLOWED_ORIGINS names it', () => {
  const env = (key: string) =>
    ({
      APP_URL: 'https://app.cliniquemana.com',
      ALLOWED_ORIGINS: 'https://app.cliniquemana.com,http://localhost:5193',
    })[key]
  const from = (origin: string) =>
    returnBase(new Request(URL_, { headers: { Origin: origin } }), env)
  assertEquals(from('http://localhost:5193'), 'http://localhost:5193')
  assertEquals(from('https://evil.test'), 'https://app.cliniquemana.com')
})

Deno.test('professionals-consent-sign: « Mes documents » returns there once signed', () => {
  assertEquals(
    redirectUrl('https://app.cliniquemana.com/', 'documents', 'consentement'),
    'https://app.cliniquemana.com/mes-documents?consentement=signe',
  )
})

Deno.test('professionals-consent-sign: professionals.self and the module are required; nothing is prepared otherwise', async () => {
  await run(async () => {
    for (
      const [options, code] of [
        [
          { permissions: ['professionals.view', 'professionals.manage'] },
          'forbidden',
        ],
        [{ modules: [] }, 'module_disabled'],
      ] as [{ permissions?: string[]; modules?: string[] }, string][]
    ) {
      const s = setup(options)
      const res = await s.handler(start())
      assertEquals(res.status, 403)
      assertEquals((await res.json()).error.code, code)
      assertEquals(
        s.service.calls.filter((c) => c.fn === 'prepare_my_image_consent')
          .length,
        0,
      )
    }
  })
})

Deno.test('professionals-consent-sign: the body names the action, the key and where to return only', async () => {
  await run(async () => {
    const s = setup()
    for (
      const b of [
        { action: 'start' },
        { action: 'start', idempotency_key: KEY, professional_id: PRO },
        { action: 'start', idempotency_key: KEY, return_step: '../admin' },
        {
          action: 'start',
          idempotency_key: KEY,
          return_to: 'https://evil.test',
        },
        { action: 'sign', idempotency_key: KEY },
      ]
    ) {
      const res = await s.handler(post(b))
      assertEquals(res.status, 400, JSON.stringify(b))
    }
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'prepare_my_image_consent').length,
      0,
    )
  })
})

Deno.test('professionals-consent-sign: no published form → the French refusal with its HINT (the step says the clinic sends it later)', async () => {
  await run(async () => {
    const message =
      "La clinique n'a pas encore publié ce formulaire : elle vous l'enverra plus tard."
    const s = setup({
      prepare: { error: { code: 'P0001', message, hint: 'template' } },
    })
    const res = await s.handler(start())
    assertEquals(res.status, 400)
    assertEquals(await res.json(), {
      error: {
        code: 'invalid_request',
        message,
        refusal: true,
        field: 'template',
      },
    })
    assertEquals(s.fake.calls.length, 0)
  })
})

Deno.test('professionals-consent-sign: sync without a request → none; with one → Documenso read, the signature applied', async () => {
  await run(async () => {
    const none = setup({ prepare: { data: { sync: null } } })
    const res = await none.handler(post({ action: 'sync' }))
    assertEquals(await res.json(), { outcome: 'none' })

    let sync: Record<string, unknown> | null = null
    const s = setup({ prepare: () => ({ data: { sync } }) })
    const old = await sentRequest(s.fake, s.db, consentOf)
    sync = { request_id: old.id, status: 'sent', envelope_id: old.envelope_id }
    s.fake.sign(old.envelope_id!)
    s.fake.complete(old.envelope_id!)
    const synced = await s.handler(post({ action: 'sync' }))
    assertEquals(synced.status, 200)
    assertEquals((await synced.json()).outcome, 'signed')
    assertEquals(s.db.requests.get(old.id)!.status, 'signed')
  })
})

Deno.test('professionals-consent-sign: Documenso down while resuming → 502, never a stale link', async () => {
  await run(async () => {
    let resume: Record<string, unknown> | null = null
    const s = setup({ prepare: () => ({ data: { resume } }) })
    const old = await sentRequest(s.fake, s.db, consentOf)
    resume = {
      request_id: old.id,
      envelope_id: old.envelope_id,
      recipient_id: old.signers[0].recipient_id,
    }
    s.fake.failures.read = 503
    const res = await s.handler(start())
    assertEquals(res.status, 502)
    assertEquals((await res.json()).error.code, 'provider_error')
  })
})
