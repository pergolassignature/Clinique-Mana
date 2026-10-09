import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
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
  CLINIC_EMAIL,
  LOCAL_APP_URL,
  sentRequest,
  SIGNER_EMAIL,
  SIGNERS,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/professionals-contract-send'
const PRO = '00000000-0000-4000-8000-0000000000b1'
const VERSION_ID = '00000000-0000-4000-8000-0000000000e1'
const KEY = '9b1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const REQUEST_KEY = `professionals.service_contract:${PRO}:${KEY}`
const PERMISSIONS = [
  'professionals.view',
  'professionals.contracts.send',
  'professionals.compensation',
]

/** A small published version with the Annexe A block placeholder (the seeded body is template.test.ts's). */
const body: PdfDocument = {
  title: 'Contrat de service',
  header: { text: 'Contrat de service', initialsFor: ['professional'] },
  footer: { text: 'Convention' },
  blocks: [
    {
      type: 'paragraph',
      runs: [{ text: 'Entre {{clinic.name}} et {{professional.full_name}}.' }],
    },
    { type: 'heading', level: 1, text: 'Annexe A' },
    { type: 'paragraph', runs: [{ text: '{{pricing.annexe_a}}' }] },
    {
      type: 'signaturePage',
      signers: [
        { role: 'professional', label: '{{professional.full_name}}' },
        { role: 'clinic', label: 'Pour la Clinique' },
      ],
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
    variable('professional.address', 'Adresse du professionnel'),
    variable('pricing.annexe_a', 'Tableau de l’Annexe A'),
  ],
  signers: [
    { role: 'professional', label: 'Professionnel', order: 1, required: true },
    { role: 'clinic', label: 'Clinique', order: 2, required: false },
  ],
  email_subject: 'Votre contrat de service avec {{clinic.name}}',
  email_message: 'Bonjour {{professional.full_name}}',
}

const annexe = {
  title_label: 'Psychologue',
  prices: [{ duration: 50, client_price_cents: 17500 }],
  tiers: [{ from: 0, to: 50, pay: [{ duration: 50, cents: 12600 }] }, {
    from: 51,
    to: null,
    pay: [{ duration: 50, cents: 12688 }],
  }],
  sessions_total: 12,
  current_tier_from: 0,
  in_force: null,
  other: [{
    kind: 'workshop',
    name: 'Ateliers et conférences',
    retention_pct: 25,
  }],
}

/** What `prepare_professional_contract` answers (the snapshot), with overrides. */
const prepared = (over: Record<string, unknown> = {}) => ({
  idempotency_key: REQUEST_KEY,
  template_version_id: VERSION_ID,
  title: 'Contrat de service — Ana Gagnon',
  values: {
    professional: {
      full_name: 'Ana Gagnon',
      address: '1, rue Exemple, Québec (QC) G1A 1A1',
    },
  },
  annexe,
  signers: [{ ...SIGNERS[0] }],
  cancel: null,
  ...over,
})

function setup(
  options: { permissions?: string[]; modules?: string[]; prepare?: RpcRoute } =
    {},
) {
  const clock = fixedClock('2026-10-08T12:00:00.000Z')
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
      prepare_professional_contract: options.prepare ?? { data: prepared() },
    },
    storage: db.storage,
  })
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(options.permissions ?? PERMISSIONS),
          org_id: SIGNING_ORG,
          modules: options.modules ?? ['professionals'],
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
  body: unknown = {
    professional_id: PRO,
    action: 'send',
    idempotency_key: KEY,
  },
) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    },
    body: JSON.stringify(body),
  })

const prepareCalls = (s: ReturnType<typeof setup>) =>
  s.service.calls.filter((c) => c.fn === 'prepare_professional_contract')

Deno.test('professionals-contract-send: send → the snapshot from the database, sent through Documenso under the request key', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post())
    const answer = await res.json()
    assertEquals(res.status, 200)
    assertEquals(answer.existing, false)
    assertEquals(prepareCalls(s).map((c) => c.args), [
      {
        p_actor: ADMIN_ID,
        p_id: PRO,
        p_action: 'send',
        p_idempotency_key: KEY,
      },
    ])
    const row = s.db.requests.get(answer.request_id)!
    assertEquals(row.status, 'sent')
    assertEquals(row.purpose, 'professionals.service_contract')
    assertEquals(row.module_key, 'professionals')
    assertEquals(row.subject_type, 'professional')
    assertEquals(row.subject_id, PRO)
    assertEquals(
      row.view_permission,
      'professionals.compensation',
      'the pay is in it (P4-435)',
    )
    assertEquals(row.idempotency_key, REQUEST_KEY)
    assertEquals(row.sent_by, ADMIN_ID)
    assertEquals(row.title, 'Contrat de service — Ana Gagnon')
    assertEquals(row.signers.map((x) => [x.role, x.email]), [[
      'professional',
      SIGNER_EMAIL,
    ]])
    const doc = s.fake.documents.get(row.envelope_id!)!
    assertEquals(
      doc.meta.subject,
      'Votre contrat de service avec Clinique MANA (local)',
    )
    assertEquals(doc.meta.language, 'fr')
    // The source PDF is in our storage before Documenso has it (ADR 0005).
    assert(row.source_file_id !== null, 'the rendered PDF is stored')
    assert(!JSON.stringify(answer).includes('@'), 'the answer holds no address')
  })
})

Deno.test('professionals-contract-send: the clinic signer, when Settings has one, signs second', async () => {
  await run(async () => {
    const s = setup({
      prepare: {
        data: prepared({ signers: [{ ...SIGNERS[0] }, { ...SIGNERS[1] }] }),
      },
    })
    const answer = await (await s.handler(post())).json()
    const row = s.db.requests.get(answer.request_id)!
    assertEquals(row.signers.map((x) => [x.role, x.order, x.email]), [
      ['professional', 1, SIGNER_EMAIL],
      ['clinic', 2, CLINIC_EMAIL],
    ])
    assertEquals(
      s.fake.documents.get(row.envelope_id!)!.meta.signingOrder,
      'SEQUENTIAL',
    )
  })
})

Deno.test('professionals-contract-send: a double click (same key) → the same request, one envelope', async () => {
  await run(async () => {
    const s = setup()
    const first = await (await s.handler(post())).json()
    const again = await (await s.handler(post())).json()
    assertEquals(again, { request_id: first.request_id, existing: true })
    assertEquals(s.fake.documents.size, 1)
  })
})

Deno.test('professionals-contract-send: the module, the permission and the compensation read are required; nothing is prepared', async () => {
  await run(async () => {
    for (
      const [options, code] of [
        [{
          permissions: ['professionals.view', 'professionals.contracts.send'],
        }, 'forbidden'],
        [
          { permissions: ['professionals.view', 'professionals.compensation'] },
          'forbidden',
        ],
        [{ modules: [] }, 'module_disabled'],
      ] as [{ permissions?: string[]; modules?: string[] }, string][]
    ) {
      const s = setup(options)
      const res = await s.handler(post())
      assertEquals(res.status, 403)
      assertEquals((await res.json()).error.code, code)
      assertEquals(prepareCalls(s).length, 0)
    }
  })
})

Deno.test('professionals-contract-send: the body names the professional, the action and the key only (never values or signers)', async () => {
  await run(async () => {
    const s = setup()
    for (
      const body of [
        {
          professional_id: PRO,
          action: 'send',
          idempotency_key: KEY,
          signers: [{ email: 'x@y.test' }],
        },
        {
          professional_id: PRO,
          action: 'send',
          idempotency_key: KEY,
          values: {},
        },
        { professional_id: PRO, action: 'sign', idempotency_key: KEY },
        { professional_id: 'nope', action: 'send', idempotency_key: KEY },
      ]
    ) {
      const res = await s.handler(post(body))
      assertEquals(res.status, 400)
      assertEquals((await res.json()).error.code, 'invalid_request')
    }
    assertEquals(prepareCalls(s).length, 0)
  })
})

Deno.test('professionals-contract-send: no published template → the French refusal, routed by its HINT', async () => {
  await run(async () => {
    const message =
      'Aucun modèle de contrat publié. Publiez « Contrat de service » dans Paramètres → Contrats.'
    const s = setup({
      prepare: { error: { code: 'P0001', message, hint: 'template' } },
    })
    const res = await s.handler(post())
    assertEquals(res.status, 400)
    assertEquals(await res.json(), {
      error: {
        code: 'invalid_request',
        message,
        refusal: true,
        field: 'template',
      },
    })
    assertEquals(s.db.requests.size, 0)
    assertEquals(s.fake.calls.length, 0)
  })
})

Deno.test('professionals-contract-send: a value the template requires is empty → missing_variable with its French label', async () => {
  await run(async () => {
    const s = setup({
      prepare: {
        data: prepared({
          values: { professional: { full_name: 'Ana Gagnon', address: null } },
        }),
      },
    })
    const res = await s.handler(post())
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error, {
      code: 'missing_variable',
      message: 'A template value is missing',
      variable: 'professional.address',
      label: 'Adresse du professionnel',
    })
    assertEquals(s.db.requests.size, 0)
  })
})

const contractOf = {
  purpose: 'professionals.service_contract',
  module_key: 'professionals',
  subject_type: 'professional',
  subject_id: PRO,
}

Deno.test('professionals-contract-send: regenerate → the open contract cancelled at Documenso, then closed, then a new one sent', async () => {
  await run(async () => {
    let cancel: Record<string, unknown> | null = null
    const s = setup({ prepare: () => ({ data: prepared({ cancel }) }) })
    const old = await sentRequest(s.fake, s.db, {
      ...contractOf,
      idempotency_key: 'professionals.service_contract:old',
    })
    cancel = {
      request_id: old.id,
      envelope_id: old.envelope_id,
      status: 'sent',
    }
    const res = await s.handler(
      post({
        professional_id: PRO,
        action: 'regenerate',
        idempotency_key: KEY,
      }),
    )
    const answer = await res.json()
    assertEquals(res.status, 200)
    assertEquals(s.fake.documents.get(old.envelope_id!)!.status, 'CANCELLED')
    assertEquals(s.db.requests.get(old.id)!.status, 'cancelled')
    assertEquals(
      s.service.calls.find((c) => c.fn === 'cancel_signature_request')!.args,
      { p_id: old.id, p_by: ADMIN_ID },
    )
    assert(answer.request_id !== old.id)
    assertEquals(s.db.requests.get(answer.request_id)!.status, 'sent')
    const order = s.fake.calls.map((c) => new URL(c.url).pathname)
    assert(
      order.indexOf(DOCUMENSO_PATHS.cancel) <
        order.indexOf(DOCUMENSO_PATHS.create),
      'cancelled before the new envelope',
    )
  })
})

Deno.test('professionals-contract-send: regenerate whose Documenso cancel fails → 502, the open contract left as it is, nothing new', async () => {
  await run(async () => {
    let cancel: Record<string, unknown> | null = null
    const s = setup({ prepare: () => ({ data: prepared({ cancel }) }) })
    const old = await sentRequest(s.fake, s.db, contractOf)
    cancel = {
      request_id: old.id,
      envelope_id: old.envelope_id,
      status: 'sent',
    }
    s.fake.failures.cancel = 500
    const res = await s.handler(
      post({
        professional_id: PRO,
        action: 'regenerate',
        idempotency_key: KEY,
      }),
    )
    assertEquals(res.status, 502)
    assertEquals((await res.json()).error.code, 'provider_error')
    assertEquals(s.db.requests.get(old.id)!.status, 'sent')
    assertEquals(s.db.requests.size, 1)
    assert(!s.service.calls.some((c) => c.fn === 'cancel_signature_request'))
  })
})

Deno.test('professionals-contract-send: regenerate of a contract Documenso already completed → the database refusal, nothing new', async () => {
  await run(async () => {
    let cancel: Record<string, unknown> | null = null
    const s = setup({ prepare: () => ({ data: prepared({ cancel }) }) })
    const old = await sentRequest(s.fake, s.db, {
      ...contractOf,
      completed_event_at: '2026-10-08T11:00:00.000Z',
    })
    cancel = { request_id: old.id, envelope_id: null, status: 'sent' }
    const res = await s.handler(
      post({
        professional_id: PRO,
        action: 'regenerate',
        idempotency_key: KEY,
      }),
    )
    assertEquals(res.status, 400)
    assertEquals(
      (await res.json()).error.message,
      'Ce document a déjà été signé : la demande ne peut plus être annulée.',
    )
    assertEquals(s.db.requests.size, 1)
  })
})

Deno.test('professionals-contract-send: resend → Documenso resends to the next signer', async () => {
  await run(async () => {
    let resend: Record<string, unknown> | null = null
    const s = setup({ prepare: () => ({ data: { resend } }) })
    const old = await sentRequest(s.fake, s.db, contractOf)
    const recipient = old.signers[0].recipient_id!
    resend = {
      request_id: old.id,
      envelope_id: old.envelope_id,
      recipient_ids: [recipient],
    }
    const res = await s.handler(
      post({ professional_id: PRO, action: 'resend', idempotency_key: KEY }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { request_id: old.id })
    const call = s.fake.calls.find((c) =>
      new URL(c.url).pathname === DOCUMENSO_PATHS.redistribute
    )!
    assertEquals(JSON.parse(call.body), {
      envelopeId: old.envelope_id,
      recipients: [Number(recipient)],
    })
  })
})

Deno.test('professionals-contract-send: an unexpected answer from the database → 500, reported, nothing sent', async () => {
  await run(async () => {
    const s = setup({ prepare: { data: { idempotency_key: REQUEST_KEY } } })
    const res = await s.handler(post())
    assertEquals(res.status, 500)
    assertEquals(s.fake.calls.length, 0)
  })
})
