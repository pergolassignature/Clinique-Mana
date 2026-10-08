import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  createSignatureRequest,
  type CreateSignatureRequestInput,
  SEND_IN_PROGRESS_MESSAGE,
  STALE_SEND_MS,
} from './signing.ts'
import {
  type PdfDocument,
  PdfError,
  type PdfRenderer,
  type SigningField,
} from './pdf/model.ts'
import { SIGNING_TEST_EMAIL, signingTestDocument } from './pdf/test-document.ts'
import { fakeDocumenso } from './testing/fake-documenso.ts'
import {
  type FakeSignatureRequest,
  fakeSigningDb,
} from './testing/fake-signing-db.ts'
import { fakeSupabase, type RpcRoute } from './testing/fake-supabase.ts'
import { fixedClock } from './testing/fixed-clock.ts'
import { captureConsole, withEnv } from './testing/env.ts'
import {
  CLINIC_EMAIL,
  MINIMAL_PDF,
  sentRequest,
  SIGNER_EMAIL,
  SIGNERS,
  SIGNING_ORG,
} from './testing/signing-fixtures.ts'
import { sha256Hex } from './storage.ts'

const NOW = '2026-10-08T12:00:00.000Z'
const VERSION_ID = '00000000-0000-4000-8000-0000000000e1'
const SUBJECT_ID = '00000000-0000-4000-8000-0000000000b1'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

const body: PdfDocument = {
  title: 'Contrat — {{professional.name}}',
  header: { text: 'Contrat', initialsFor: ['professional'] },
  footer: { text: '{{clinic.name}}' },
  blocks: [
    { type: 'image', assetKey: 'logo', width: 120 },
    { type: 'paragraph', runs: [{ text: 'Entre {{clinic.name}} et vous.' }] },
    {
      type: 'signaturePage',
      signers: [
        { role: 'professional', label: 'Professionnel' },
        { role: 'clinic', label: 'Clinique' },
      ],
    },
  ],
}

const version = {
  id: VERSION_ID,
  module_key: 'professionals',
  view_permission: 'professionals.view',
  body,
  variables: [
    {
      path: 'professional.name',
      label: 'Nom',
      sample: 'Ana',
      required: true,
      kind: 'text',
    },
    {
      path: 'clinic.name',
      label: 'Clinique',
      sample: 'MANA',
      required: true,
      kind: 'text',
    },
  ],
  signers: [
    { role: 'professional', label: 'Professionnel', order: 1, required: true },
    { role: 'clinic', label: 'Clinique', order: 2, required: false },
  ],
  email_subject: 'Votre contrat avec {{clinic.name}}',
  email_message: 'Bonjour {{professional.name}}',
}

const FIELDS: SigningField[] = [
  {
    role: 'professional',
    type: 'INITIALS',
    page: 1,
    x: 80,
    y: 3,
    width: 8,
    height: 4,
  },
  {
    role: 'professional',
    type: 'SIGNATURE',
    page: 2,
    x: 10,
    y: 40,
    width: 30,
    height: 8,
  },
  {
    role: 'clinic',
    type: 'SIGNATURE',
    page: 2,
    x: 10,
    y: 60,
    width: 30,
    height: 8,
  },
]

const input = (
  over: Partial<CreateSignatureRequestInput> = {},
): CreateSignatureRequestInput => ({
  orgId: SIGNING_ORG,
  moduleKey: 'professionals',
  purpose: 'professionals.service_contract',
  templateVersionId: VERSION_ID,
  subject: { type: 'professional', id: SUBJECT_ID },
  title: 'Contrat de service — Ana Gagnon',
  viewPermission: 'professionals.view',
  values: { professional: { name: 'Ana Gagnon' } },
  signers: [{ ...SIGNERS[0] } as CreateSignatureRequestInput['signers'][0]],
  idempotencyKey: 'professionals.service_contract:click-1',
  sentBy: null,
  ...over,
})

interface SetupOptions {
  apiKey?: string | null
  modules?: string[]
  rpc?: Record<string, RpcRoute>
  upload?: () => { error: { message: string } }
}

function setup(options: SetupOptions = {}) {
  const clock = fixedClock(NOW)
  const order: string[] = []
  const fake = fakeDocumenso()
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    apiKey: options.apiKey,
    modules: options.modules ?? ['professionals'],
    versions: { [VERSION_ID]: version },
    logo: { file_id: 'logo', bucket: 'org-assets', object_path: 'o/logo.png' },
    signature: {
      file_id: 'sig',
      bucket: 'org-assets',
      object_path: 'o/sig.png',
    },
  })
  db.objects.set('org-assets/o/logo.png', PNG)
  db.objects.set('org-assets/o/sig.png', PNG)
  const traced = Object.fromEntries(
    Object.entries({ ...db.rpc, ...options.rpc }).map(([name, route]) => [
      name,
      (args: Record<string, unknown>) => {
        order.push(name)
        return typeof route === 'function' ? route(args) : route
      },
    ]),
  )
  let downloading = 0
  const supabase = fakeSupabase({
    rpc: traced,
    storage: {
      download: async (bucket, path) => {
        order.push(`download ${path}`)
        downloading++
        await new Promise((r) => setTimeout(r, 1))
        order.push(`downloaded (${downloading} at once)`)
        downloading--
        return db.storage.download(bucket, path)
      },
      upload: (bucket, ...args) => {
        order.push(`upload ${bucket}`)
        return options.upload
          ? options.upload()
          : db.storage.upload(bucket, ...args)
      },
    },
  })
  const rendered: PdfDocument[] = []
  const renderer: PdfRenderer = {
    render: (doc, assets) => {
      order.push(`render (${Object.keys(assets).sort().join(',')})`)
      rendered.push(doc)
      return Promise.resolve({
        bytes: MINIMAL_PDF,
        pageCount: 2,
        fields: FIELDS,
      })
    },
  }
  const fetch: typeof globalThis.fetch = (input, init) => {
    const req = new Request(input, init)
    order.push(`documenso ${req.method} ${new URL(req.url).pathname}`)
    return fake.fetch(req)
  }
  const deps = { client: supabase.client, fetch, now: clock.now, renderer }
  return { clock, order, fake, db, supabase, deps, rendered }
}

const run = (fn: () => Promise<void>) => withEnv({ SENTRY_DSN: undefined }, fn)

/** A draft of `input()`'s key and signer (as an earlier attempt left it). */
function existingDraft(
  s: ReturnType<typeof setup>,
  over: Partial<FakeSignatureRequest> = {},
): FakeSignatureRequest {
  return s.db.insertRequest({
    id: 'r-draft',
    idempotency_key: input().idempotencyKey,
    module_key: 'professionals',
    purpose: 'professionals.service_contract',
    subject_type: 'professional',
    subject_id: SUBJECT_ID,
    view_permission: 'professionals.view',
    last_error: 'mark_sent_failed',
    signers: [{
      id: 's1',
      role: 'professional',
      name: 'Ana Gagnon',
      email: SIGNER_EMAIL,
      order: 1,
      recipient_id: null,
      status: 'pending',
    }],
    ...over,
  })
}

/**
 * A draft whose earlier send created document 1 at Documenso (distributed:
 * PENDING) before failing, as the fixture `sentRequest` builds it.
 */
async function draftWithDocument(s: ReturnType<typeof setup>) {
  const row = await sentRequest(s.fake, s.db, {
    id: 'r-draft',
    status: 'draft',
    idempotency_key: input().idempotencyKey,
    module_key: 'professionals',
    purpose: 'professionals.service_contract',
    subject_type: 'professional',
    subject_id: SUBJECT_ID,
    view_permission: 'professionals.view',
    sent_at: null,
    expires_at: null,
    last_error: 'mark_sent_failed',
  })
  for (const signer of row.signers) signer.recipient_id = null
  s.order.length = 0
  return row
}

Deno.test('createSignatureRequest: the happy path, in order', async () => {
  await run(async () => {
    const s = setup()
    const result = await createSignatureRequest(s.deps, input())
    assert(result.ok)
    assertEquals(result.existing, false)
    assertEquals(s.order, [
      'get_signing_context',
      'get_org_secret',
      'create_signature_request',
      'begin_signature_request_send',
      'download o/logo.png',
      'downloaded (1 at once)',
      'render (logo)',
      'register_system_file',
      'upload documents',
      'documenso POST /api/v2/document/create',
      'documenso GET /api/v2/document/1',
      'documenso POST /api/v2/document/field/create-many',
      'documenso POST /api/v2/document/distribute',
      'mark_signature_request_sent',
    ])
    const row = s.db.requests.get(result.requestId)!
    assertEquals(row.status, 'sent')
    assertEquals(row.documenso_document_id, '1')
    assertEquals(row.envelope_id, 'envelope_1')
    assertEquals(row.expires_at, '2026-10-15T12:00:00.000Z')
    const source = s.db.files.get(row.source_file_id!)!
    assertEquals(source.purpose, 'signing_source')
    assertEquals(source.view_permission, 'professionals.view')
    assertEquals(source.sha256, sha256Hex(MINIMAL_PDF))
    assertEquals(source.retain_until, null)
  })
})

Deno.test('createSignatureRequest: the template is filled (values, then the clinic) and both images load in parallel', async () => {
  await run(async () => {
    const s = setup()
    version.body = {
      ...body,
      blocks: [
        { type: 'image', assetKey: 'signature', width: 80 },
        ...body.blocks,
      ],
    }
    try {
      await createSignatureRequest(
        s.deps,
        input({
          values: {
            professional: { name: 'Ana Gagnon' },
            clinic: { name: 'Fausse clinique' },
          },
        }),
      )
    } finally {
      version.body = body
    }
    assertEquals(s.rendered[0].title, 'Contrat — Ana Gagnon')
    assertEquals(s.rendered[0].footer.text, 'Clinique MANA (local)')
    assertEquals(s.order.filter((o) => o.startsWith('download ')).length, 2)
    assert(s.order.includes('downloaded (2 at once)'), 'parallel downloads')
    assert(s.order.includes('render (logo,signature)'))
  })
})

Deno.test('createSignatureRequest: Documenso gets the filled invitation, French, the expiry, recipients in order; fields go to their signer', async () => {
  await run(async () => {
    const s = setup()
    const result = await createSignatureRequest(s.deps, input())
    assert(result.ok)
    const doc = s.fake.documents.get('1')!
    assertEquals(doc.externalId, result.requestId)
    assertEquals(doc.title, 'Contrat de service — Ana Gagnon')
    assertEquals(doc.meta.subject, 'Votre contrat avec Clinique MANA (local)')
    assertEquals(doc.meta.message, 'Bonjour Ana Gagnon')
    assertEquals(doc.meta.language, 'fr')
    assertEquals(doc.meta.distributionMethod, 'EMAIL')
    assertEquals(doc.meta.signingOrder, 'PARALLEL')
    assertEquals(doc.meta.envelopeExpirationPeriod, { unit: 'day', amount: 7 })
    assertEquals(doc.recipients.map((r) => r.email), [SIGNER_EMAIL])
    // The clinic's box has no signer in this request: its field is dropped.
    assertEquals(
      doc.fields.map((f) => [f.recipientId, f.type, f.page]),
      [['101', 'INITIALS', 1], ['101', 'SIGNATURE', 2]],
    )
    const row = s.db.requests.get(result.requestId)!
    assertEquals(row.signers.map((x) => [x.role, x.recipient_id]), [
      ['professional', '101'],
    ])
  })
})

Deno.test('createSignatureRequest: two signers → sequential, each recipient keyed by role', async () => {
  await run(async () => {
    const s = setup()
    const result = await createSignatureRequest(
      s.deps,
      input({
        signers: [SIGNERS[1], SIGNERS[0]].map((x) => ({
          ...x,
        })) as CreateSignatureRequestInput['signers'],
      }),
    )
    assert(result.ok)
    const doc = s.fake.documents.get('1')!
    assertEquals(doc.meta.signingOrder, 'SEQUENTIAL')
    assertEquals(doc.recipients.map((r) => [r.email, r.signingOrder]), [
      [SIGNER_EMAIL, 1],
      [CLINIC_EMAIL, 2],
    ])
    const sent = s.supabase.calls.find((c) =>
      c.fn === 'mark_signature_request_sent'
    )!
    assertEquals(sent.args.p_signer_recipients, [
      { role: 'professional', recipient_id: '101' },
      { role: 'clinic', recipient_id: '102' },
    ])
    assertEquals(doc.fields.map((f) => f.recipientId), ['101', '101', '102'])
  })
})

Deno.test('createSignatureRequest: idempotency, an existing sent row → returned, no Documenso call, no render', async () => {
  await run(async () => {
    const s = setup()
    const first = await createSignatureRequest(s.deps, input())
    s.order.length = 0
    const again = await createSignatureRequest(s.deps, input())
    assertEquals(again, {
      ok: true,
      requestId: first.requestId!,
      existing: true,
    })
    assertEquals(s.order, [
      'get_signing_context',
      'get_org_secret',
      'create_signature_request',
    ])
    assertEquals(s.fake.documents.size, 1)
  })
})

Deno.test('createSignatureRequest: a double click while the first send runs → send_in_progress, no render, no second document', async () => {
  await run(async () => {
    const s = setup()
    existingDraft(s, {
      last_error: null,
      send_started_at: '2026-10-08T11:59:30.000Z',
    })
    const result = await createSignatureRequest(s.deps, input())
    assertEquals(result, {
      ok: false,
      code: 'send_in_progress',
      message: 'Un envoi est déjà en cours.',
      requestId: 'r-draft',
    })
    assertEquals(SEND_IN_PROGRESS_MESSAGE, 'Un envoi est déjà en cours.')
    assertEquals(s.rendered.length, 0)
    assertEquals(s.fake.calls.length, 0)
  })
})

Deno.test('createSignatureRequest: two concurrent sends of one key → exactly one document; the other is told a send is under way', async () => {
  await run(async () => {
    for (const fresh of [true, false]) {
      const s = setup()
      if (!fresh) existingDraft(s) // a concurrent « Renvoyer » of a failed draft
      const results = await Promise.all([
        createSignatureRequest(s.deps, input()),
        createSignatureRequest(s.deps, input()),
      ])
      assertEquals(
        results.map((r) => r.ok ? 'sent' : r.code).sort(),
        ['send_in_progress', 'sent'],
      )
      assertEquals(s.fake.documents.size, 1)
      assertEquals(s.rendered.length, 1)
      assertEquals(s.db.requests.size, 1)
      assertEquals([...s.db.requests.values()][0].status, 'sent')
    }
  })
})

Deno.test('createSignatureRequest: the same key with other signers → invalid_request with the database message', async () => {
  await run(async () => {
    const s = setup()
    existingDraft(s)
    const result = await createSignatureRequest(
      s.deps,
      input({
        signers: [{
          role: 'professional',
          name: 'Ana Gagnon',
          email: 'autre@example.test',
          order: 1,
        }],
      }),
    )
    assertEquals(result, {
      ok: false,
      code: 'invalid_request',
      message: 'Les signataires ne correspondent pas à la demande existante.',
      requestId: null,
    })
    assertEquals(s.fake.calls.length, 0)
  })
})

Deno.test('createSignatureRequest: re-send with a live earlier document (pending) → cancelled first, then a new document replaces it', async () => {
  await run(async () => {
    const s = setup()
    await draftWithDocument(s)
    const result = await createSignatureRequest(s.deps, input())
    assertEquals(result, { ok: true, requestId: 'r-draft', existing: true })
    const documenso = s.order.filter((o) => o.startsWith('documenso'))
    assertEquals(documenso.slice(0, 3), [
      'documenso GET /api/v2/document/1',
      'documenso POST /api/v2/envelope/cancel',
      'documenso POST /api/v2/document/create',
    ])
    assert(
      s.order.indexOf('documenso POST /api/v2/envelope/cancel') <
        s.order.findIndex((o) => o.startsWith('render')),
      'settled before rendering',
    )
    assertEquals(s.fake.documents.get('1')!.status, 'CANCELLED')
    assertEquals(s.fake.documents.get('2')!.status, 'PENDING')
    const row = s.db.requests.get('r-draft')!
    assertEquals(row.status, 'sent')
    assertEquals(row.documenso_document_id, '2')
    assertEquals(row.superseded_document_ids, ['1'])
    assertEquals(row.send_started_at, null)
  })
})

Deno.test('createSignatureRequest: re-send with an earlier document still a draft at Documenso → deleted by its id, then sent', async () => {
  await run(async () => {
    const s = setup()
    await draftWithDocument(s)
    s.fake.documents.get('1')!.status = 'DRAFT'
    const result = await createSignatureRequest(s.deps, input())
    assert(result.ok)
    assert(s.order.includes('documenso POST /api/v2/document/delete'))
    assertEquals(s.fake.documents.has('1'), false)
    assertEquals(s.db.requests.get('r-draft')!.documenso_document_id, '2')
  })
})

Deno.test('createSignatureRequest: re-send whose earlier cancel fails → aborted (provider_error), retryable at once, no second document', async () => {
  await run(async () => {
    const s = setup()
    await draftWithDocument(s)
    s.fake.failures.cancel = 500
    const result = await createSignatureRequest(s.deps, input())
    assertEquals(result, {
      ok: false,
      code: 'provider_error',
      requestId: 'r-draft',
    })
    assertEquals(s.fake.documents.size, 1)
    assertEquals(s.rendered.length, 0)
    const row = s.db.requests.get('r-draft')!
    assertEquals(row.status, 'draft')
    assertEquals(row.last_error, 'previous_cancel_failed')
    assertEquals(row.send_started_at, null, 'the claim is released')
    assertEquals(row.documenso_document_id, '1')
    delete s.fake.failures.cancel
    assert((await createSignatureRequest(s.deps, input())).ok, 'retried')
    assertEquals(s.fake.documents.get('1')!.status, 'CANCELLED')
    assertEquals(s.db.requests.get('r-draft')!.documenso_document_id, '2')
  })
})

Deno.test('createSignatureRequest: re-send whose earlier document Documenso completed → recovered (signed), never sent again', async () => {
  await run(async () => {
    const s = setup()
    await draftWithDocument(s)
    s.fake.complete('1')
    assertEquals(
      s.fake.documents.get('1')!.externalId,
      'r-draft',
      'held under the request id: its own document',
    )
    const result = await createSignatureRequest(s.deps, input())
    assertEquals(result, { ok: true, requestId: 'r-draft', existing: true })
    assertEquals(s.fake.documents.size, 1, 'no second document')
    assertEquals(s.rendered.length, 0, 'nothing rendered')
    assertEquals(
      s.fake.calls.filter((c) => c.method === 'POST').map((c) => c.url),
      [],
      'nothing cancelled or created',
    )
    const row = s.db.requests.get('r-draft')!
    assertEquals(row.status, 'signed')
    assertEquals(row.documenso_document_id, '1')
    assertEquals(row.source_file_id, null, 'no staged source: recorded missing')
    assertEquals(row.signers.map((x) => x.recipient_id), ['101'])
  })
})

Deno.test('createSignatureRequest: re-send whose earlier document id is held under another externalId → signing_foreign_document (ids only), never recovered nor cancelled, sent again', async () => {
  await run(async () => {
    for (const status of ['COMPLETED', 'PENDING'] as const) {
      const s = setup()
      await draftWithDocument(s)
      if (status === 'COMPLETED') s.fake.complete('1')
      s.fake.documents.get('1')!.externalId = 'another-request'
      let result
      const lines = await captureConsole('error', async () => {
        result = await createSignatureRequest(s.deps, input())
      })
      assertEquals(result, { ok: true, requestId: 'r-draft', existing: true })
      const report = JSON.stringify(lines)
      assert(report.includes('signing_foreign_document'), status)
      assert(report.includes('r-draft'))
      assert(!report.includes('@'), 'ids only')
      assert(
        !s.supabase.calls.some((c) => c.fn === 'recover_signature_request'),
        `${status}: not recovered`,
      )
      assertEquals(
        s.order.filter((o) => /cancel|delete/.test(o)),
        [],
        `${status}: not cancelled`,
      )
      assertEquals(s.fake.documents.get('1')!.status, status)
      const row = s.db.requests.get('r-draft')!
      assertEquals(row.status, 'sent')
      assertEquals(row.documenso_document_id, '2')
      assertEquals(row.superseded_document_ids, ['1'])
    }
  })
})

Deno.test('createSignatureRequest: re-send whose earlier document reads without an externalId → previous_read_failed (provider_error, retryable), never taken for a foreign document', async () => {
  await run(async () => {
    const s = setup()
    await draftWithDocument(s)
    s.fake.documents.get('1')!.externalId = undefined
    let result
    const lines = await captureConsole('error', async () => {
      result = await createSignatureRequest(s.deps, input())
    })
    assertEquals(result, {
      ok: false,
      code: 'provider_error',
      requestId: 'r-draft',
    })
    assert(
      !JSON.stringify(lines).includes('signing_foreign_document'),
      'not reported foreign',
    )
    assertEquals(s.fake.documents.size, 1, 'no second document')
    assertEquals(s.rendered.length, 0, 'nothing rendered')
    assertEquals(
      s.order.filter((o) => /cancel|delete/.test(o)),
      [],
      'not cancelled',
    )
    assertEquals(s.fake.documents.get('1')!.status, 'PENDING')
    const row = s.db.requests.get('r-draft')!
    assertEquals(row.status, 'draft')
    assertEquals(row.last_error, 'previous_read_failed')
    assertEquals(row.send_started_at, null, 'the claim is released')
    assertEquals(row.documenso_document_id, '1')
    assertEquals(row.superseded_document_ids, [])
    s.fake.documents.get('1')!.externalId = 'r-draft'
    assert((await createSignatureRequest(s.deps, input())).ok, 'retried')
    assertEquals(s.fake.documents.get('1')!.status, 'CANCELLED')
    assertEquals(s.db.requests.get('r-draft')!.documenso_document_id, '2')
  })
})

Deno.test('createSignatureRequest: re-send whose earlier document is cancelled, rejected or gone → sent again without a cancel', async () => {
  await run(async () => {
    for (const status of ['CANCELLED', 'REJECTED', 'gone'] as const) {
      const s = setup()
      await draftWithDocument(s)
      if (status === 'gone') s.fake.documents.delete('1')
      else s.fake.documents.get('1')!.status = status
      const result = await createSignatureRequest(s.deps, input())
      assert(result.ok, status)
      assertEquals(
        s.order.filter((o) => /cancel|delete/.test(o)),
        [],
        `${status}: no cancel`,
      )
      assertEquals(s.db.requests.get('r-draft')!.documenso_document_id, '2')
    }
  })
})

Deno.test('createSignatureRequest: a draft that failed before (last_error), or died silently, is sent again on the same row', async () => {
  await run(async () => {
    for (
      const over of [
        { last_error: 'provider_unavailable', created_at: NOW },
        {
          // Its claim is older than STALE_SEND_MS: the send died.
          last_error: null,
          send_started_at: new Date(Date.parse(NOW) - STALE_SEND_MS - 1000)
            .toISOString(),
        },
      ]
    ) {
      const s = setup()
      existingDraft(s, over)
      const result = await createSignatureRequest(s.deps, input())
      assertEquals(result, { ok: true, requestId: 'r-draft', existing: true })
      assertEquals(s.db.requests.get('r-draft')!.status, 'sent')
      assertEquals(s.db.requests.get('r-draft')!.last_error, null)
    }
  })
})

Deno.test('createSignatureRequest: an abandoned draft with this key → provider_error, nothing sent', async () => {
  await run(async () => {
    const s = setup()
    existingDraft(s, { last_error: 'abandoned' })
    assertEquals(await createSignatureRequest(s.deps, input()), {
      ok: false,
      code: 'provider_error',
      requestId: 'r-draft',
    })
    assertEquals(s.fake.calls.length, 0)
  })
})

Deno.test('createSignatureRequest: no key or no URL → not_configured, no row', async () => {
  await run(async () => {
    const s = setup({ apiKey: null })
    assertEquals(await createSignatureRequest(s.deps, input()), {
      ok: false,
      code: 'not_configured',
      requestId: null,
    })
    assertEquals(s.db.requests.size, 0)
    assertEquals(s.order, ['get_signing_context', 'get_org_secret'])
  })
})

Deno.test('createSignatureRequest: a disabled module → module_disabled, no row', async () => {
  await run(async () => {
    const s = setup({ modules: [] })
    assertEquals(await createSignatureRequest(s.deps, input()), {
      ok: false,
      code: 'module_disabled',
      requestId: null,
    })
    assertEquals(s.db.requests.size, 0)
  })
})

Deno.test('createSignatureRequest: a missing required value → missing_variable, no row', async () => {
  await run(async () => {
    const s = setup()
    assertEquals(
      await createSignatureRequest(s.deps, input({ values: {} })),
      { ok: false, code: 'missing_variable', requestId: null },
    )
    assertEquals(s.db.requests.size, 0)
  })
})

Deno.test('createSignatureRequest: a refusal of the database (P0001) → invalid_request with its French message', async () => {
  await run(async () => {
    const s = setup({
      rpc: {
        create_signature_request: {
          error: {
            code: 'P0001',
            message:
              'Une demande de signature est déjà en cours pour ce dossier.',
          },
        },
      },
    })
    assertEquals(await createSignatureRequest(s.deps, input()), {
      ok: false,
      code: 'invalid_request',
      message: 'Une demande de signature est déjà en cours pour ce dossier.',
      requestId: null,
    })
  })
})

Deno.test('createSignatureRequest: a distribute failure → the document is cancelled, the draft marked provider_unavailable', async () => {
  await run(async () => {
    const s = setup()
    s.fake.failures.distribute = 503
    const result = await createSignatureRequest(s.deps, input())
    assert(!result.ok)
    assertEquals(result.code, 'provider_error')
    const row = s.db.requests.get(result.requestId!)!
    assertEquals(row.status, 'draft')
    assertEquals(row.last_error, 'provider_unavailable')
    assertEquals(row.documenso_document_id, '1')
    assertEquals(row.envelope_id, 'envelope_1')
    // Not distributed: cancelled by its document id (a draft is deleted).
    assert(s.order.includes('documenso POST /api/v2/document/delete'))
    assertEquals(s.fake.documents.has('1'), false)
  })
})

Deno.test('createSignatureRequest: Documenso refusing the key → not_configured, the draft marked provider_not_configured', async () => {
  await run(async () => {
    const s = setup()
    s.fake.failures.create = 401
    const result = await createSignatureRequest(s.deps, input())
    assert(!result.ok)
    assertEquals(result.code, 'not_configured')
    assertEquals(
      s.db.requests.get(result.requestId!)!.last_error,
      'provider_not_configured',
    )
  })
})

Deno.test('createSignatureRequest: a failed upload discards the file, marks the draft and throws; Documenso is never called', async () => {
  await run(async () => {
    const s = setup({ upload: () => ({ error: { message: 'boom' } }) })
    const error = await assertRejects(() =>
      createSignatureRequest(s.deps, input())
    )
    assertEquals((error as { code: string }).code, 'source_upload_failed')
    assertEquals([...s.db.files.values()].map((f) => f.status), ['deleted'])
    assertEquals([...s.db.requests.values()][0].last_error, 'storage_failed')
    assertEquals(s.fake.calls.length, 0)
  })
})

Deno.test('createSignatureRequest: mark_signature_request_sent failing → the distributed envelope is cancelled, the draft marked, then a throw', async () => {
  await run(async () => {
    const s = setup({
      rpc: { mark_signature_request_sent: { error: { code: '57014' } } },
    })
    const error = await assertRejects(() =>
      createSignatureRequest(s.deps, input())
    )
    assertEquals((error as { code: string }).code, 'mark_sent_failed')
    assert(s.order.includes('documenso POST /api/v2/envelope/cancel'))
    assertEquals(s.fake.documents.get('1')!.status, 'CANCELLED')
    const row = [...s.db.requests.values()][0]
    assertEquals(row.last_error, 'mark_sent_failed')
    assertEquals(row.documenso_document_id, '1')
  })
})

Deno.test('createSignatureRequest: a template asset that is not set up → not_configured, the draft marked missing_asset', async () => {
  await run(async () => {
    const s = setup()
    const renderer: PdfRenderer = {
      render: () => Promise.reject(new PdfError('missing_asset', 'logo')),
    }
    const result = await createSignatureRequest(
      { ...s.deps, renderer },
      input(),
    )
    assertEquals(result.ok, false)
    assertEquals(!result.ok && result.code, 'not_configured')
    assertEquals([...s.db.requests.values()][0].last_error, 'missing_asset')
  })
})

Deno.test('createSignatureRequest: the built-in test document renders for real, with its own invitation', async () => {
  await run(async () => {
    const s = setup()
    const result = await createSignatureRequest(
      { ...s.deps, renderer: undefined },
      input({
        moduleKey: 'core',
        purpose: 'core.signing_test',
        templateVersionId: null,
        subject: { type: 'signing_test', id: SUBJECT_ID },
        title: 'Document test de signature électronique',
        viewPermission: 'settings.integrations_manage',
        values: {},
        signers: [{
          role: 'clinic',
          name: 'Christine Tremblay',
          email: CLINIC_EMAIL,
          order: 1,
        }],
        document: signingTestDocument('Clinique MANA (local)'),
        email: SIGNING_TEST_EMAIL,
      }),
    )
    assert(result.ok)
    const doc = s.fake.documents.get('1')!
    assertEquals(doc.meta.subject, SIGNING_TEST_EMAIL.subject)
    assertEquals(
      new TextDecoder().decode(doc.pdf.subarray(0, 5)),
      '%PDF-',
    )
    assertEquals(
      doc.fields.map((f) => f.type).sort(),
      ['DATE', 'INITIALS', 'SIGNATURE'],
    )
    assertEquals(s.db.requests.get(result.requestId)!.status, 'sent')
  })
})
