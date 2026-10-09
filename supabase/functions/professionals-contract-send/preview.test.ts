/**
 * « Préparer le contrat » (P4-502): `preview: true` renders what the same
 * action and key would send, and sends nothing. The PDF a send then stores
 * is the previewed one, byte for byte (the snapshot per key, P4-434, and a
 * deterministic renderer).
 */
import { assert, assertEquals } from '@std/assert'
import { createHandler, toBase64 } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
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
import { countingLimiter } from '../_shared/testing/link-fixtures.ts'
import {
  CLINIC_EMAIL,
  LOCAL_APP_URL,
  sentRequest,
  SIGNERS,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/professionals-contract-send'
const PRO = '00000000-0000-4000-8000-0000000000b1'
const VERSION_ID = '00000000-0000-4000-8000-0000000000e1'
const CONSENT_VERSION_ID = '00000000-0000-4000-8000-0000000000e2'
const KEY = '9b1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const REQUEST_KEY = `professionals.service_contract:${PRO}:${KEY}`
const PERMISSIONS = [
  'professionals.view',
  'professionals.contracts.send',
  'professionals.compensation',
]

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
const consentVersion = {
  ...version,
  id: CONSENT_VERSION_ID,
  body: {
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
        signers: [{
          role: 'professional',
          label: '{{professional.full_name}}',
        }],
      },
    ],
  } satisfies PdfDocument,
  variables: [
    variable('clinic.name', 'Nom de la clinique'),
    variable('professional.full_name', 'Nom du professionnel'),
  ],
  signers: [
    { role: 'professional', label: 'Professionnel', order: 1, required: true },
  ],
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
  signers: [{ ...SIGNERS[1] }, { ...SIGNERS[0] }],
  cancel: null,
  ...over,
})

function setup(
  options: {
    permissions?: string[]
    modules?: string[]
    prepare?: RpcRoute
    limiter?: RpcRoute
  } = {},
) {
  const clock = fixedClock('2026-10-08T12:00:00.000Z')
  const fake = fakeDocumenso()
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    modules: ['professionals'],
    versions: { [VERSION_ID]: version, [CONSENT_VERSION_ID]: consentVersion },
  })
  const service = fakeSupabase({
    rpc: {
      ...db.rpc,
      prepare_professional_contract: options.prepare ?? { data: prepared() },
      prepare_professional_image_consent: {
        data: {
          idempotency_key: `professionals.image_consent:${PRO}:${KEY}`,
          template_version_id: CONSENT_VERSION_ID,
          title: 'Consentement au droit à l’image — Ana Gagnon',
          values: { professional: { full_name: 'Ana Gagnon' } },
          signers: [{ ...SIGNERS[0] }],
          cancel: null,
        },
      },
      ...(options.limiter ? { consume_rate_limit: options.limiter } : {}),
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
  return { fake, db, service, handler: createHandler(deps) }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)

const post = (body: Record<string, unknown>) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    },
    body: JSON.stringify(body),
  })
const preview = (over: Record<string, unknown> = {}) =>
  post({
    professional_id: PRO,
    action: 'send',
    idempotency_key: KEY,
    preview: true,
    ...over,
  })

const decode = (b64: string) =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

const prepareCalls = (s: ReturnType<typeof setup>) =>
  s.service.calls.filter((c) => c.fn === 'prepare_professional_contract')

Deno.test('preview: the PDF, its pages, the signers by name and Annexe A’s values; nothing sent, stored or requested', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(preview())
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    const answer = await res.json()
    const pdf = decode(answer.pdf)
    assertEquals(new TextDecoder().decode(pdf.subarray(0, 5)), '%PDF-')
    assert(answer.page_count >= 2, 'the contract and its signature page')
    assertEquals(answer.template_version_id, VERSION_ID)
    assertEquals(answer.title, 'Contrat de service — Ana Gagnon')
    assertEquals(answer.signers, [
      { role: 'professional', name: SIGNERS[0].name, order: 1 },
      { role: 'clinic', name: SIGNERS[1].name, order: 2 },
    ])
    assertEquals(answer.summary[0], {
      label: 'Profession',
      value: 'Psychologue',
    })
    assertEquals(answer.summary[1].value, '12 (palier « 0 à 50 séances »)')
    assert(String(answer.summary[2].value).includes('126'), 'the pay today')
    assert(!JSON.stringify(answer).includes('@'), 'no address in the answer')
    assert(!JSON.stringify(answer).includes(CLINIC_EMAIL))
    // The same RPC call a send makes: the snapshot is written under this key.
    assertEquals(prepareCalls(s).map((c) => c.args), [{
      p_actor: ADMIN_ID,
      p_id: PRO,
      p_action: 'send',
      p_idempotency_key: KEY,
    }])
    assertEquals(s.db.requests.size, 0)
    assertEquals(s.db.objects.size, 0)
    assertEquals(s.fake.calls.length, 0, 'Documenso is never called')
  })
})

Deno.test('preview then send with the same key → the stored source PDF is the previewed one, byte for byte', async () => {
  await run(async () => {
    const s = setup()
    const shown = decode((await (await s.handler(preview())).json()).pdf)
    const res = await s.handler(
      post({ professional_id: PRO, action: 'send', idempotency_key: KEY }),
    )
    assertEquals(res.status, 200)
    const row = s.db.requests.get((await res.json()).request_id)!
    assertEquals(row.status, 'sent')
    const source = s.db.files.get(row.source_file_id!)!
    const stored = s.db.objects.get(`${source.bucket}/${source.object_path}`)!
    assertEquals(toBase64(stored), toBase64(shown))
    assertEquals(
      prepareCalls(s).map((c) => c.args.p_idempotency_key),
      [KEY, KEY],
      'one key, one snapshot',
    )
  })
})

Deno.test('preview of « Régénérer » → the open contract is left as it is: nothing cancelled', async () => {
  await run(async () => {
    let cancel: Record<string, unknown> | null = null
    const s = setup({ prepare: () => ({ data: prepared({ cancel }) }) })
    const old = await sentRequest(s.fake, s.db, {
      purpose: 'professionals.service_contract',
      module_key: 'professionals',
      subject_type: 'professional',
      subject_id: PRO,
      idempotency_key: 'professionals.service_contract:old',
    })
    cancel = {
      request_id: old.id,
      envelope_id: old.envelope_id,
      status: 'sent',
    }
    const before = s.fake.calls.length
    const res = await s.handler(preview({ action: 'regenerate' }))
    assertEquals(res.status, 200)
    assertEquals(prepareCalls(s)[0].args.p_action, 'regenerate')
    assertEquals(s.db.requests.get(old.id)!.status, 'sent')
    assertEquals(s.fake.documents.get(old.envelope_id!)!.status, 'PENDING')
    assertEquals(s.fake.calls.length, before, 'no Documenso call')
    assert(!s.service.calls.some((c) => c.fn === 'cancel_signature_request'))
  })
})

Deno.test('preview: the send’s permissions and module gate; nothing prepared without them', async () => {
  await run(async () => {
    for (
      const [options, form, code] of [
        [
          {
            permissions: ['professionals.view', 'professionals.contracts.send'],
          },
          'service_contract',
          'forbidden',
        ],
        [
          { permissions: ['professionals.view', 'professionals.compensation'] },
          'service_contract',
          'forbidden',
        ],
        [{ permissions: PERMISSIONS }, 'image_consent', 'forbidden'],
        [{ modules: [] }, 'service_contract', 'module_disabled'],
      ] as [{ permissions?: string[]; modules?: string[] }, string, string][]
    ) {
      const s = setup(options)
      const res = await s.handler(preview({ form }))
      assertEquals(res.status, 403)
      assertEquals((await res.json()).error.code, code)
      assertEquals(
        s.service.calls.filter((c) => c.fn.startsWith('prepare_')).length,
        0,
      )
    }
  })
})

Deno.test('preview: « Renvoyer » has nothing to preview → 400', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(preview({ action: 'resend' }))
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error.code, 'invalid_request')
    assertEquals(prepareCalls(s).length, 0)
  })
})

Deno.test('preview: its own bucket (30 an hour per caller), never the sends’', async () => {
  await run(async () => {
    const limiter = countingLimiter()
    const s = setup({ limiter: limiter.route })
    for (let i = 0; i < 30; i++) {
      assertEquals((await s.handler(preview())).status, 200)
    }
    const refused = await s.handler(preview())
    assertEquals(refused.status, 429)
    assertEquals((await refused.json()).error.code, 'rate_limited')
    const buckets = new Set(
      s.service.calls.filter((c) => c.fn === 'consume_rate_limit').map((c) =>
        c.args.p_bucket
      ),
    )
    assertEquals([...buckets], ['professionals.contract_preview'])
    // The send still has its whole budget.
    assertEquals(
      (await s.handler(
        post({ professional_id: PRO, action: 'send', idempotency_key: KEY }),
      )).status,
      200,
    )
  })
})

Deno.test('preview: a refusal or a missing value shows before anything is sent', async () => {
  await run(async () => {
    const message = 'Aucun modèle de contrat publié.'
    const refused = setup({
      prepare: { error: { code: 'P0001', message, hint: 'template' } },
    })
    const res = await refused.handler(preview())
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error, {
      code: 'invalid_request',
      message,
      refusal: true,
      field: 'template',
    })

    const missing = setup({
      prepare: {
        data: prepared({
          values: { professional: { full_name: 'Ana Gagnon', address: null } },
        }),
      },
    })
    const answer = await missing.handler(preview())
    assertEquals(answer.status, 400)
    assertEquals((await answer.json()).error.label, 'Adresse du professionnel')
    assertEquals(missing.db.requests.size, 0)
    assertEquals(missing.fake.calls.length, 0)
  })
})

Deno.test('preview: the image consent → its own prepare, no Annexe A summary', async () => {
  await run(async () => {
    const s = setup({
      permissions: ['professionals.view', 'professionals.manage'],
    })
    const res = await s.handler(preview({ form: 'image_consent' }))
    assertEquals(res.status, 200)
    const answer = await res.json()
    assertEquals(answer.summary, [])
    assertEquals(answer.template_version_id, CONSENT_VERSION_ID)
    assertEquals(prepareCalls(s).length, 0)
    assertEquals(s.db.requests.size, 0)
  })
})
