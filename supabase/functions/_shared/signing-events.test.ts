import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  applyEvents,
  documentEvents,
  failureCode,
  isDocumensoOutage,
  isDocumentMissing,
  normaliseEventName,
  orgSigning,
  readDraftEnvelope,
  reconcileOrg,
  SigningFailure,
  storeSignedPdf,
  syncRequest,
  webhookEvents,
} from './signing-events.ts'
import { documensoClient, DocumensoError } from './documenso.ts'
import { fakeDocumenso } from './testing/fake-documenso.ts'
import { fakeFetch } from './testing/fake-fetch.ts'
import { fakeSigningDb } from './testing/fake-signing-db.ts'
import { fakeSupabase } from './testing/fake-supabase.ts'
import { fixedClock } from './testing/fixed-clock.ts'
import { captureConsole, withEnv } from './testing/env.ts'
import {
  DOCUMENSO_KEY,
  LOCAL_REACH,
  sentRequest,
  SIGNERS,
  SIGNING_ORG,
} from './testing/signing-fixtures.ts'
import { sha256Hex } from './storage.ts'

/** Envelope ids the fake Documenso never made: one a row holds, others nobody does. */
const HELD = 'envelope_hsnzzscbexaddcar'
const OTHER = 'envelope_zzzzzzzzzzzzzzzz'
const GONE = 'envelope_goneaaaaaaaaaaaa'

const NOW = '2026-10-08T12:00:00.000Z'
const run = (fn: () => Promise<void>) => withEnv({ SENTRY_DSN: undefined }, fn)

function setup(options: { latencyMs?: number } = {}) {
  const clock = fixedClock(NOW)
  const fake = fakeDocumenso({ latencyMs: options.latencyMs })
  const db = fakeSigningDb({ orgId: SIGNING_ORG, now: clock.now })
  const supabase = fakeSupabase({ rpc: db.rpc, storage: db.storage })
  const documenso = documensoClient(fake.baseUrl, DOCUMENSO_KEY, fake.fetch, {
    reach: LOCAL_REACH,
  })
  const ctx = {
    client: supabase.client,
    orgId: SIGNING_ORG,
    signing: { documenso, expiryDays: 7 },
    now: clock.now,
    fetch: fake.fetch,
    fn: 'signing-test',
  }
  return { clock, fake, db, supabase, documenso, ctx }
}

const rpcNames = (s: { calls: { fn: string }[] }) => s.calls.map((c) => c.fn)

// ---------------------------------------------------------------------------
// Event names and mapping
// ---------------------------------------------------------------------------
Deno.test('normaliseEventName: Documenso raw names stay, dot names (PS Hub) are mapped, junk is null', () => {
  assertEquals(normaliseEventName('DOCUMENT_COMPLETED'), 'DOCUMENT_COMPLETED')
  assertEquals(normaliseEventName('document.completed'), 'DOCUMENT_COMPLETED')
  assertEquals(
    normaliseEventName('document.recipient.completed'),
    'DOCUMENT_RECIPIENT_COMPLETED',
  )
  assertEquals(normaliseEventName('DOCUMENT COMPLETED'), null)
  assertEquals(normaliseEventName(''), null)
  assertEquals(normaliseEventName('x'.repeat(65)), null)
})

const snapshot = {
  status: 'PENDING',
  completedAt: null,
  recipients: [
    {
      id: '101',
      readStatus: 'OPENED',
      signingStatus: 'SIGNED',
      signedAt: '2026-10-08T10:00:00.000Z',
      rejectionReason: null,
    },
    {
      id: '102',
      readStatus: 'OPENED',
      signingStatus: 'NOT_SIGNED',
      signedAt: null,
      rejectionReason: null,
    },
    {
      id: '103',
      readStatus: 'NOT_OPENED',
      signingStatus: 'NOT_SIGNED',
      signedAt: null,
      rejectionReason: null,
    },
  ],
}

Deno.test('documentEvents: per recipient (signed, else opened), then the terminal status', () => {
  assertEquals(documentEvents(snapshot), [
    {
      event: 'DOCUMENT_SIGNED',
      recipientId: '101',
      at: '2026-10-08T10:00:00.000Z',
      reason: null,
    },
    { event: 'DOCUMENT_OPENED', recipientId: '102', at: null, reason: null },
  ])
  assertEquals(
    documentEvents({
      ...snapshot,
      status: 'COMPLETED',
      completedAt: '2026-10-08T11:00:00.000Z',
    }).at(-1),
    {
      event: 'DOCUMENT_COMPLETED',
      recipientId: null,
      at: '2026-10-08T11:00:00.000Z',
      reason: null,
    },
  )
  const rejected = {
    ...snapshot,
    status: 'REJECTED',
    recipients: [{
      ...snapshot.recipients[1],
      signingStatus: 'REJECTED',
      rejectionReason: 'Non merci',
    }],
  }
  assertEquals(documentEvents(rejected), [{
    event: 'DOCUMENT_REJECTED',
    recipientId: '102',
    at: null,
    reason: 'Non merci',
  }])
  assertEquals(
    documentEvents({ ...snapshot, status: 'CANCELLED', recipients: [] }),
    [{
      event: 'DOCUMENT_CANCELLED',
      recipientId: null,
      at: null,
      reason: null,
    }],
  )
})

Deno.test('webhookEvents: only what the event says, with the webhook time as a fallback', () => {
  const at = '2026-10-08T11:30:00.000Z'
  assertEquals(webhookEvents('DOCUMENT_OPENED', snapshot, at), [
    { event: 'DOCUMENT_OPENED', recipientId: '101', at, reason: null },
    { event: 'DOCUMENT_OPENED', recipientId: '102', at, reason: null },
  ])
  assertEquals(
    webhookEvents('DOCUMENT_OPENED', { ...snapshot, recipients: [] }, at),
    [{ event: 'DOCUMENT_OPENED', recipientId: null, at, reason: null }],
  )
  assertEquals(webhookEvents('DOCUMENT_RECIPIENT_COMPLETED', snapshot, at), [{
    event: 'DOCUMENT_RECIPIENT_COMPLETED',
    recipientId: '101',
    at: '2026-10-08T10:00:00.000Z',
    reason: null,
  }])
  assertEquals(webhookEvents('DOCUMENT_COMPLETED', snapshot, at), [
    { event: 'DOCUMENT_COMPLETED', recipientId: null, at, reason: null },
  ])
  assertEquals(webhookEvents('DOCUMENT_SENT', snapshot, at), [])
  assertEquals(webhookEvents('DOCUMENT_CREATED', snapshot, at), [])
})

// ---------------------------------------------------------------------------
// applyEvents
// ---------------------------------------------------------------------------
Deno.test('applyEvents: in order, each call by the request id', async () => {
  const { fake, db, supabase } = setup()
  const row = await sentRequest(fake, db)
  const recipient = row.signers[0].recipient_id
  const result = await applyEvents(
    supabase.client,
    SIGNING_ORG,
    { requestId: row.id, envelopeId: row.envelope_id },
    [
      {
        event: 'DOCUMENT_OPENED',
        recipientId: recipient,
        at: null,
        reason: null,
      },
      {
        event: 'DOCUMENT_SIGNED',
        recipientId: recipient,
        at: null,
        reason: null,
      },
    ],
  )
  assertEquals(result, {
    outcome: 'applied',
    requestId: row.id,
    needsDownload: false,
  })
  assertEquals(supabase.calls.map((c) => c.args.p_request_id), [row.id, row.id])
  assertEquals(db.requests.get(row.id)!.signers[0].status, 'signed')
})

Deno.test('applyEvents: retry and not_found stop at once; nothing to apply is ignored', async () => {
  const { db, supabase } = setup()
  db.insertRequest({ id: 'r1', envelope_id: HELD })
  const event = {
    event: 'DOCUMENT_COMPLETED',
    recipientId: null,
    at: null,
    reason: null,
  }
  assertEquals(
    (await applyEvents(supabase.client, SIGNING_ORG, {
      requestId: 'r1',
      envelopeId: HELD,
    }, [event, event])).outcome,
    'retry',
  )
  assertEquals(supabase.calls.length, 1)
  assertEquals(
    (await applyEvents(supabase.client, SIGNING_ORG, {
      requestId: 'r-unknown',
      envelopeId: HELD,
    }, [event])).outcome,
    'not_found',
    'an envelope id alone finds nothing: r1 holds it, but under another id',
  )
  assertEquals(
    await applyEvents(supabase.client, SIGNING_ORG, {
      requestId: 'r-unknown',
      envelopeId: OTHER,
    }, []),
    { outcome: 'ignored', requestId: 'r-unknown', needsDownload: false },
  )
})

Deno.test('applyEvents: an RPC error throws a coded failure', async () => {
  const supabase = fakeSupabase({
    rpc: { apply_signing_event: { error: { code: '57014' } } },
  })
  const error = await assertRejects(() =>
    applyEvents(supabase.client, SIGNING_ORG, {
      requestId: 'r',
      envelopeId: null,
    }, [{
      event: 'DOCUMENT_OPENED',
      recipientId: null,
      at: null,
      reason: null,
    }])
  )
  assertEquals((error as { code: string }).code, 'apply_failed')
})

// ---------------------------------------------------------------------------
// orgSigning
// ---------------------------------------------------------------------------
Deno.test('orgSigning: the address, the key and the expiry in one read; either missing → null', async () => {
  const clock = fixedClock(NOW)
  for (
    const [baseUrl, apiKey, configured] of [
      [undefined, undefined, true],
      [null, undefined, false],
      [undefined, null, false],
    ] as const
  ) {
    const db = fakeSigningDb({
      orgId: SIGNING_ORG,
      now: clock.now,
      baseUrl,
      apiKey,
    })
    const supabase = fakeSupabase({ rpc: db.rpc })
    const signing = await orgSigning(
      supabase.client,
      SIGNING_ORG,
      fetch,
      LOCAL_REACH,
    )
    assertEquals(signing !== null, configured)
    assertEquals(rpcNames(supabase), ['get_signing_credentials'])
    assertEquals(supabase.calls[0].args, { p_org_id: SIGNING_ORG })
  }
})

Deno.test('orgSigning: the key goes to the address read with it (one snapshot), never one read apart', async () => {
  const supabase = fakeSupabase({
    rpc: {
      get_signing_credentials: {
        data: [{
          base_url: 'http://host.docker.internal:55390',
          api_key: 'key-for-this-address',
          expiry_days: 9,
        }],
      },
      // A separate read would see another address: never called.
      get_signing_context: {
        data: { settings: { base_url: 'https://other.test', expiry_days: 1 } },
      },
      get_org_secret: { data: 'another-key' },
    },
  })
  const seen: { url: string; key: string | null }[] = []
  const signing = await orgSigning(
    supabase.client,
    SIGNING_ORG,
    (input, init) => {
      seen.push({
        url: String(input),
        key: new Headers(
          (init as { headers?: HeadersInit } | undefined)?.headers,
        )
          .get('Authorization'),
      })
      return Promise.resolve(Response.json({ data: [] }))
    },
    LOCAL_REACH,
  )
  assertEquals(signing!.expiryDays, 9)
  await signing!.documenso.ping()
  assertEquals(seen, [{
    url: 'http://host.docker.internal:55390/api/v2/envelope?perPage=1',
    key: 'key-for-this-address',
  }])
  assertEquals(rpcNames(supabase), ['get_signing_credentials'])
})

Deno.test('orgSigning: an RPC error or no row → signing_config_failed', async () => {
  for (const route of [{ error: { code: '57014' } }, { data: [] }]) {
    const supabase = fakeSupabase({ rpc: { get_signing_credentials: route } })
    const error = await assertRejects(() =>
      orgSigning(supabase.client, SIGNING_ORG, fetch, LOCAL_REACH)
    )
    assertEquals((error as { code: string }).code, 'signing_config_failed')
  }
})

// ---------------------------------------------------------------------------
// storeSignedPdf
// ---------------------------------------------------------------------------
Deno.test('storeSignedPdf: download → register (request view permission) → upload (no upsert) → complete with the SHA-256', async () => {
  const { fake, db, supabase, documenso } = setup()
  const row = await sentRequest(fake, db, {
    view_permission: 'professionals.view',
  })
  fake.complete(row.envelope_id!)
  await storeSignedPdf(supabase.client, documenso, SIGNING_ORG, {
    id: row.id,
    envelopeId: row.envelope_id!,
    viewPermission: 'professionals.view',
  })
  assertEquals(rpcNames(supabase), [
    'register_system_file',
    'complete_signature_request',
  ])
  const register = supabase.calls[0].args
  const signed = [...db.objects.values()][0]
  assertEquals(register.p_bucket, 'signed-documents')
  assertEquals(register.p_purpose, 'signing_signed')
  assertEquals(register.p_module_key, 'core')
  assertEquals(register.p_subject_type, 'signature_request')
  assertEquals(register.p_subject_id, row.id)
  assertEquals(register.p_view_permission, 'professionals.view')
  assertEquals(register.p_sha256, sha256Hex(signed))
  assertEquals(register.p_size_bytes, signed.length)
  assert(!String(register.p_original_name).includes('@'))
  const upload = supabase.storageCalls[0]
  assertEquals(upload.bucket, 'signed-documents')
  assertEquals(upload.args[2], {
    contentType: 'application/pdf',
    upsert: false,
  })
  assertEquals(db.requests.get(row.id)!.status, 'signed')
  assertEquals(db.requests.get(row.id)!.signed_sha256, sha256Hex(signed))
})

Deno.test('storeSignedPdf: a failed upload soft-deletes the registered file and throws', async () => {
  const { fake, db, documenso } = setup()
  const row = await sentRequest(fake, db)
  fake.complete(row.envelope_id!)
  const supabase = fakeSupabase({
    rpc: db.rpc,
    storage: { upload: () => ({ error: { message: 'boom' } }) },
  })
  const error = await assertRejects(() =>
    storeSignedPdf(supabase.client, documenso, SIGNING_ORG, {
      id: row.id,
      envelopeId: row.envelope_id!,
      viewPermission: row.view_permission,
    })
  )
  assertEquals((error as { code: string }).code, 'signed_upload_failed')
  assertEquals(rpcNames(supabase), [
    'register_system_file',
    'discard_system_file',
  ])
  assertEquals([...db.files.values()].map((f) => f.status), ['deleted'])
  assertEquals(db.requests.get(row.id)!.status, 'sent')
})

Deno.test('storeSignedPdf: a download that is not a PDF registers nothing', async () => {
  const { db, supabase } = setup()
  const documenso = {
    downloadSigned: () => Promise.resolve(new TextEncoder().encode('<html>')),
  } as unknown as ReturnType<typeof documensoClient>
  const error = await assertRejects(() =>
    storeSignedPdf(supabase.client, documenso, SIGNING_ORG, {
      id: 'r',
      envelopeId: HELD,
      viewPermission: 'settings.integrations_manage',
    })
  )
  assertEquals((error as { code: string }).code, 'signed_pdf_invalid')
  assertEquals(supabase.calls.length, 0)
  assertEquals(db.files.size, 0)
})

Deno.test('storeSignedPdf: another delivery completed the request first → this file is discarded, done', async () => {
  const { fake, db, supabase, documenso } = setup()
  const row = await sentRequest(fake, db)
  fake.complete(row.envelope_id!)
  // The other delivery won the race between our download and our complete.
  db.insertFile({
    id: 'f-theirs',
    purpose: 'signing_signed',
    subject_id: row.id,
  })
  Object.assign(db.requests.get(row.id)!, {
    status: 'signed',
    signed_file_id: 'f-theirs',
  })
  await storeSignedPdf(supabase.client, documenso, SIGNING_ORG, {
    id: row.id,
    envelopeId: row.envelope_id!,
    viewPermission: row.view_permission,
  })
  assertEquals(rpcNames(supabase), [
    'register_system_file',
    'complete_signature_request',
    'get_signing_request',
    'discard_system_file',
  ])
  const ours = [...db.files.values()].find((f) => f.id !== 'f-theirs')!
  assertEquals(ours.status, 'deleted')
  assertEquals(db.requests.get(row.id)!.signed_file_id, 'f-theirs')
})

Deno.test('storeSignedPdf: complete refused for another reason → complete_failed', async () => {
  const { fake, db, documenso } = setup()
  const row = await sentRequest(fake, db)
  fake.complete(row.envelope_id!)
  const supabase = fakeSupabase({
    rpc: {
      ...db.rpc,
      complete_signature_request: { error: { code: '22023' } },
    },
    storage: db.storage,
  })
  const error = await assertRejects(() =>
    storeSignedPdf(supabase.client, documenso, SIGNING_ORG, {
      id: row.id,
      envelopeId: row.envelope_id!,
      viewPermission: row.view_permission,
    })
  )
  assertEquals((error as { code: string }).code, 'complete_failed')
  assert(!rpcNames(supabase).includes('discard_system_file'))
})

// ---------------------------------------------------------------------------
// syncRequest
// ---------------------------------------------------------------------------
Deno.test('syncRequest: a lost completion → events applied, signed PDF stored', async () => {
  await run(async () => {
    const { fake, db, supabase, ctx } = setup()
    const row = await sentRequest(fake, db)
    fake.complete(row.envelope_id!)
    assertEquals(await syncRequest(ctx, row, { settleDrafts: false }), 'signed')
    assertEquals(db.requests.get(row.id)!.status, 'signed')
    assert(rpcNames(supabase).includes('get_signing_request'))
    // One envelope read: its item id goes straight to the download.
    assertEquals(
      fake.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
      [
        `GET /api/v2/envelope/${row.envelope_id}`,
        `GET /api/v2/envelope/item/${
          fake.documents.get(row.envelope_id!)!.items[0].id
        }/download`,
      ],
    )
  })
})

Deno.test("readDraftEnvelope: Documenso's NOT_FOUND → null (gone); a proxy's 404 or a 500 throws", async () => {
  const base = 'http://host.docker.internal:55390'
  const url = `GET ${base}/api/v2/envelope/${HELD}`
  const report = { fn: 'test', orgId: SIGNING_ORG, fetch }
  const cases = [
    [
      () =>
        Response.json({ message: 'Envelope not found', code: 'NOT_FOUND' }, {
          status: 404,
        }),
      null,
    ],
    [() => new Response('<html>404</html>', { status: 404 }), 404],
    [
      () =>
        Response.json({ message: 'boom', code: 'NOT_FOUND' }, { status: 500 }),
      500,
    ],
  ] as const
  for (const [responder, status] of cases) {
    const documenso = documensoClient(
      base,
      DOCUMENSO_KEY,
      fakeFetch({ [url]: responder }).fetch,
      {
        reach: LOCAL_REACH,
      },
    )
    const attempt = readDraftEnvelope(report, documenso, 'r1', HELD)
    if (status === null) assertEquals(await attempt, null)
    else {
      const error = await assertRejects(() => attempt, DocumensoError)
      assertEquals([error.status, error.notFound], [status, false])
    }
  }
})

Deno.test('fake signing db: one envelope per org, as the database (23505)', async () => {
  const { db, supabase } = setup()
  db.insertRequest({ id: 'r1', status: 'sent', envelope_id: HELD })
  db.insertRequest({ id: 'r2' })
  const { error } = await supabase.client.rpc('mark_signature_request_failed', {
    p_id: 'r2',
    p_error_code: 'provider_error',
    p_envelope_id: HELD,
  })
  assertEquals(error?.code, '23505')
  assertEquals(db.requests.get('r2')!.envelope_id, null)
})

Deno.test('syncRequest: an opened document → viewed; nothing new → unchanged', async () => {
  const { fake, db, ctx } = setup()
  const row = await sentRequest(fake, db)
  fake.open(row.envelope_id!)
  assertEquals(await syncRequest(ctx, row, { settleDrafts: false }), 'updated')
  assertEquals(db.requests.get(row.id)!.status, 'viewed')
  assertEquals(
    await syncRequest(ctx, db.requests.get(row.id)!, { settleDrafts: false }),
    'unchanged',
  )
})

Deno.test('syncRequest: a sent request whose document is held under another externalId → signing_foreign_document before any event or download', async () => {
  for (const externalId of [null, 'another-request']) {
    const { fake, db, supabase, ctx } = setup()
    const row = await sentRequest(fake, db)
    const doc = row.envelope_id!
    fake.complete(doc)
    fake.documents.get(doc)!.externalId = externalId
    const error = await assertRejects(() =>
      syncRequest(ctx, row, { settleDrafts: true })
    )
    assertEquals(
      [
        (error as { code: string }).code,
        (error as { requestId: string }).requestId,
      ],
      ['signing_foreign_document', row.id],
    )
    assertEquals(rpcNames(supabase), [], 'nothing applied')
    assertEquals(
      fake.calls.map((c) => c.method),
      ['GET'],
      'one read, no download',
    )
    assertEquals(db.requests.get(row.id)!.status, 'sent')
  }
})

Deno.test('syncRequest: completed, but the request now records another envelope → signing_foreign_document, nothing downloaded', async () => {
  const { fake, db, ctx } = setup()
  const row = await sentRequest(fake, db)
  fake.complete(row.envelope_id!)
  const listed = { ...row }
  // Recorded since the list was read (the read before the download is fresh),
  // while the completion was applied for the listed envelope all the same.
  db.requests.get(row.id)!.envelope_id = OTHER
  const supabase = fakeSupabase({
    rpc: {
      ...db.rpc,
      apply_signing_event: {
        data: [{
          outcome: 'applied',
          request_id: row.id,
          module_key: 'core',
          needs_download: true,
        }],
      },
    },
    storage: db.storage,
  })
  const error = await assertRejects(() =>
    syncRequest({ ...ctx, client: supabase.client }, listed, {
      settleDrafts: false,
    })
  )
  assertEquals((error as { code: string }).code, 'signing_foreign_document')
  // Two events (signers, then completion), then the fresh read.
  assertEquals(rpcNames(supabase).at(-1), 'get_signing_request')
  assertEquals(
    rpcNames(supabase).filter((n) => n !== 'apply_signing_event'),
    ['get_signing_request'],
  )
  assertEquals(fake.calls.filter((c) => c.url.includes('/download')), [])
})

Deno.test('syncRequest: a request with no Documenso document → unchanged, no call', async () => {
  const { db, fake, ctx } = setup()
  const row = db.insertRequest({ id: 'r1' })
  assertEquals(await syncRequest(ctx, row, { settleDrafts: true }), 'unchanged')
  assertEquals(fake.calls.length, 0)
})

/** A draft whose send died after Documenso distributed it (two signers). */
async function deadDraft(
  s: ReturnType<typeof setup>,
  staged: boolean,
) {
  const row = await sentRequest(s.fake, s.db, {
    status: 'draft',
    sent_at: null,
    expires_at: null,
    last_error: null,
    created_at: '2026-10-08T11:58:00.000Z',
  }, SIGNERS)
  for (const signer of row.signers) signer.recipient_id = null
  if (staged) {
    s.db.insertFile({ id: 'f-src', subject_id: row.id })
  }
  return row
}

Deno.test('syncRequest: a draft Documenso completed, its PDF still staged → claimed, recovered (roles by signing order, the source taken), then signed', async () => {
  await run(async () => {
    const s = setup()
    const row = await deadDraft(s, true)
    s.fake.complete(row.envelope_id!)
    assertEquals(
      s.fake.documents.get(row.envelope_id!)!.externalId,
      row.id,
      'held under the request id: its own document',
    )
    assertEquals(
      await syncRequest(s.ctx, row, { settleDrafts: false }),
      'signed',
    )
    const names = rpcNames(s.supabase)
    assert(
      names.indexOf('begin_signature_request_send') <
        names.indexOf('recover_signature_request'),
      'claimed first',
    )
    const recovered = s.supabase.calls.find((c) =>
      c.fn === 'recover_signature_request'
    )!
    const docRecipients = s.fake.documents.get(row.envelope_id!)!
      .recipients
    assertEquals(recovered.args.p_envelope_id, row.envelope_id)
    assertEquals(recovered.args.p_signer_recipients, [
      { role: 'professional', recipient_id: docRecipients[0].id },
      { role: 'clinic', recipient_id: docRecipients[1].id },
    ])
    const done = s.db.requests.get(row.id)!
    assertEquals(done.status, 'signed')
    assertEquals(done.source_file_id, 'f-src')
    assertEquals(s.db.files.get('f-src')!.retain_until, null)
    assertEquals(
      s.fake.calls.filter((c) =>
        c.url.includes('cancel') || c.url.includes('delete')
      ),
      [],
    )
    // The envelope read once; the recovery's download reuses its item id.
    assertEquals(
      s.fake.calls.filter((c) => c.url.includes(`/envelope/${row.envelope_id}`))
        .length,
      1,
    )
  })
})

Deno.test('syncRequest: a draft Documenso completed, its PDF no longer staged → recovered anyway (signed), the source recorded missing and reported', async () => {
  await run(async () => {
    const s = setup()
    const row = await deadDraft(s, false)
    s.fake.complete(row.envelope_id!)
    const lines = await captureConsole('error', async () => {
      assertEquals(
        await syncRequest(s.ctx, row, { settleDrafts: true }),
        'signed',
      )
    })
    const report = JSON.stringify(lines)
    assert(report.includes('signing_source_missing'))
    assert(report.includes(row.id))
    assert(!report.includes('@'))
    const done = s.db.requests.get(row.id)!
    assertEquals(done.status, 'signed')
    assertEquals(done.source_file_id, null)
    assert(done.signed_file_id !== null)
    assertEquals(
      s.fake.calls.filter((c) => c.method === 'POST'),
      [],
      'no cancel at Documenso',
    )
  })
})

Deno.test('syncRequest: a completed draft whose recipients do not match by signing order → signing_orphan_completed (ids only), released with that code, never cancelled', async () => {
  await run(async () => {
    const s = setup()
    const row = await deadDraft(s, true)
    s.fake.complete(row.envelope_id!)
    s.fake.documents.get(row.envelope_id!)!.recipients[1]
      .signingOrder = 5
    const lines = await captureConsole('error', async () => {
      assertEquals(
        await syncRequest(s.ctx, row, { settleDrafts: true }),
        'orphan_completed',
      )
    })
    const report = JSON.stringify(lines)
    assert(report.includes('signing_orphan_completed'))
    assert(report.includes(row.id))
    assert(!report.includes('@'))
    const draft = s.db.requests.get(row.id)!
    assertEquals(draft.status, 'draft')
    assertEquals(draft.last_error, 'orphan_completed')
    assertEquals(draft.send_started_at, null)
    assertEquals(
      s.fake.calls.filter((c) => c.method === 'POST'),
      [],
      'no cancel at Documenso',
    )
  })
})

Deno.test('syncRequest: a draft whose document id is held under another externalId → signing_foreign_document (ids only), never recovered nor cancelled', async () => {
  await run(async () => {
    for (const status of ['COMPLETED', 'PENDING'] as const) {
      const s = setup()
      const row = await deadDraft(s, true)
      const doc = row.envelope_id!
      if (status === 'COMPLETED') s.fake.complete(doc)
      s.fake.documents.get(doc)!.externalId = 'another-request'
      const lines = await captureConsole('error', async () => {
        assertEquals(
          await syncRequest(s.ctx, row, { settleDrafts: false }),
          'unchanged',
          `${status}: user mode leaves it`,
        )
        assertEquals(
          await syncRequest(s.ctx, row, { settleDrafts: true }),
          'abandoned',
          `${status}: the reconcile treats it as gone`,
        )
      })
      const report = JSON.stringify(lines)
      assert(report.includes('signing_foreign_document'), status)
      assert(report.includes(row.id))
      assert(report.includes(doc))
      assert(!report.includes('@'), 'ids only')
      assert(
        !rpcNames(s.supabase).includes('recover_signature_request'),
        `${status}: not recovered`,
      )
      assertEquals(
        s.fake.calls.filter((c) => c.method === 'POST'),
        [],
        `${status}: nothing cancelled at Documenso`,
      )
      assertEquals(s.fake.documents.get(doc)!.status, status)
      const draft = s.db.requests.get(row.id)!
      assertEquals([draft.status, draft.last_error], ['draft', 'abandoned'])
      assertEquals(s.db.files.get('f-src')!.retain_until !== null, true)
    }
  })
})

Deno.test('syncRequest: a settle re-reads the draft under its claim: a send that recorded another envelope since the list → that envelope is settled', async () => {
  await run(async () => {
    const s = setup()
    // Listed with its first envelope (PENDING then)…
    const listed = await deadDraft(s, false)
    const first = listed.envelope_id!
    // …then a « Renvoyer » cancelled it and its new envelope failed after
    // distribute: the draft now records that one.
    await s.documenso.cancel(first)
    const resent = await sentRequest(s.fake, s.db, {
      id: listed.id,
      status: 'draft',
      sent_at: null,
      expires_at: null,
      last_error: 'mark_sent_failed',
      created_at: listed.created_at,
      superseded_envelope_ids: [first],
    }, SIGNERS)
    for (const signer of resent.signers) signer.recipient_id = null
    const second = resent.envelope_id!
    assert(second !== first)
    assertEquals(
      await syncRequest(s.ctx, listed, { settleDrafts: true }),
      'abandoned',
    )
    assertEquals(s.fake.documents.get(second)!.status, 'CANCELLED')
    const cancels = s.fake.calls.filter((c) => c.method === 'POST')
    assertEquals(cancels.length, 1)
    assertEquals(JSON.parse(cancels[0].body).envelopeId, second)
    const draft = s.db.requests.get(listed.id)!
    assertEquals(draft.last_error, 'abandoned')
    assertEquals(draft.envelope_id, second)
  })
})

Deno.test('syncRequest: a completed draft re-read under its claim → recovered on its current envelope, never the one listed', async () => {
  await run(async () => {
    const s = setup()
    const listed = await deadDraft(s, false)
    const first = listed.envelope_id!
    await s.documenso.cancel(first)
    const resent = await sentRequest(s.fake, s.db, {
      id: listed.id,
      status: 'draft',
      sent_at: null,
      expires_at: null,
      last_error: 'mark_sent_failed',
      created_at: listed.created_at,
      superseded_envelope_ids: [first],
    }, SIGNERS)
    for (const signer of resent.signers) signer.recipient_id = null
    const second = resent.envelope_id!
    s.fake.complete(second)
    await captureConsole('error', async () => {
      assertEquals(
        await syncRequest(s.ctx, listed, { settleDrafts: true }),
        'signed',
      )
    })
    const recovered = s.supabase.calls.find((c) =>
      c.fn === 'recover_signature_request'
    )!
    assertEquals(recovered.args.p_envelope_id, second)
    assertEquals(s.db.requests.get(listed.id)!.status, 'signed')
  })
})

Deno.test('syncRequest: a stale draft still pending → cancelled at Documenso, then abandoned; user mode leaves it', async () => {
  const s = setup()
  const row = await deadDraft(s, true)
  assertEquals(
    await syncRequest(s.ctx, row, { settleDrafts: false }),
    'unchanged',
  )
  assertEquals(
    s.fake.documents.get(row.envelope_id!)!.status,
    'PENDING',
  )
  assertEquals(
    await syncRequest(s.ctx, row, { settleDrafts: true }),
    'abandoned',
  )
  assertEquals(
    s.fake.documents.get(row.envelope_id!)!.status,
    'CANCELLED',
  )
  assertEquals(s.db.requests.get(row.id)!.last_error, 'abandoned')
})

Deno.test('syncRequest: a draft whose send is under way (fresh claim) → sending: nothing read is acted on', async () => {
  const s = setup()
  const row = await deadDraft(s, true)
  s.db.requests.get(row.id)!.send_started_at = '2026-10-08T11:55:00.000Z'
  assertEquals(
    await syncRequest(s.ctx, row, { settleDrafts: true }),
    'sending',
  )
  s.fake.complete(row.envelope_id!)
  assertEquals(
    await syncRequest(s.ctx, row, { settleDrafts: false }),
    'sending',
  )
  assertEquals(s.db.requests.get(row.id)!.status, 'draft')
  assertEquals(s.fake.calls.filter((c) => c.method === 'POST'), [])
})

Deno.test('syncRequest: a failed settle releases the claim with its code', async () => {
  await run(async () => {
    const s = setup()
    const row = await deadDraft(s, true)
    s.fake.failures.cancel = 500
    await captureConsole('error', async () => {
      const error = await assertRejects(() =>
        syncRequest(s.ctx, row, { settleDrafts: true })
      )
      assertEquals((error as { code: string }).code, 'provider_error')
    })
    const draft = s.db.requests.get(row.id)!
    assertEquals(draft.last_error, 'provider_error')
    assertEquals(draft.send_started_at, null)
  })
})

Deno.test('syncRequest: a stale draft whose envelope is gone at Documenso → abandoned', async () => {
  const s = setup()
  const row = s.db.insertRequest({ id: 'r1', envelope_id: GONE })
  assertEquals(
    await syncRequest(s.ctx, row, { settleDrafts: true }),
    'abandoned',
  )
  assertEquals(s.db.requests.get('r1')!.last_error, 'abandoned')
})

// ---------------------------------------------------------------------------
// reconcileOrg (the core.signing_reconcile job)
// ---------------------------------------------------------------------------
function cronSetup(latencyMs = 0) {
  const s = setup({ latencyMs })
  const deps = { fetch: s.fake.fetch, now: s.clock.now, reach: LOCAL_REACH }
  const perOrg = reconcileOrg(deps, 'signing-sync')
  const signal = new AbortController().signal
  return { ...s, perOrg, signal }
}

Deno.test('reconcileOrg: 10 requests → at most 4 Documenso calls in flight', async () => {
  await run(async () => {
    const s = cronSetup(5)
    for (let i = 0; i < 10; i++) await sentRequest(s.fake, s.db)
    s.fake.inFlight.max = 0
    const detail = await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    assert(s.fake.inFlight.max > 1, 'requests run concurrently')
    assert(s.fake.inFlight.max <= 4, `max in flight ${s.fake.inFlight.max}`)
    assertEquals(detail, '10 demandes suivies (10 inchangées)')
  })
})

Deno.test('reconcileOrg: an overdue request whose completion was lost is downloaded, not expired', async () => {
  await run(async () => {
    const s = cronSetup()
    const row = await sentRequest(s.fake, s.db, {
      expires_at: '2026-10-07T12:00:00.000Z',
    })
    s.fake.complete(row.envelope_id!)
    const detail = await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    assertEquals(detail, '1 demande suivie (1 signée)')
    assertEquals(s.db.requests.get(row.id)!.status, 'signed')
    assert(!rpcNames(s.supabase).includes('expire_signature_request'))
  })
})

Deno.test('reconcileOrg: an overdue pending request → synced, expired in the database, then cancelled at Documenso', async () => {
  await run(async () => {
    const s = cronSetup()
    const row = await sentRequest(s.fake, s.db, {
      expires_at: '2026-10-07T12:00:00.000Z',
    })
    s.fake.open(row.envelope_id!)
    const order: string[] = []
    const client = fakeSupabase({
      rpc: Object.fromEntries(
        Object.entries(s.db.rpc).map(([name, route]) => [name, (args) => {
          order.push(name)
          return typeof route === 'function' ? route(args) : route
        }]),
      ),
      storage: s.db.storage,
    }).client
    const documensoFetch = s.fake.fetch
    const traced: typeof fetch = (input, init) => {
      order.push(`documenso ${new URL(new Request(input, init).url).pathname}`)
      return documensoFetch(input, init)
    }
    const perOrg = reconcileOrg(
      { fetch: traced, now: s.clock.now, reach: LOCAL_REACH },
      'signing-sync',
    )
    const detail = await perOrg(SIGNING_ORG, client, s.signal)
    assertEquals(detail, '1 demande suivie (1 expirée)')
    const doc = row.envelope_id!
    assertEquals(order.filter((o) => !o.startsWith('get_')), [
      'list_signature_requests_to_reconcile',
      `documenso /api/v2/envelope/${doc}`,
      'apply_signing_event',
      'expire_signature_request',
      'documenso /api/v2/envelope/cancel',
      'record_signature_sync',
    ])
    assertEquals(s.db.requests.get(row.id)!.status, 'expired')
    assertEquals(s.fake.documents.get(doc)!.status, 'CANCELLED')
  })
})

Deno.test('reconcileOrg: a stale draft with no document is abandoned without Documenso', async () => {
  await run(async () => {
    const s = cronSetup()
    s.db.insertRequest({ id: 'r1', created_at: '2026-10-06T12:00:00.000Z' })
    const detail = await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    assertEquals(detail, '1 demande suivie (1 abandonnée)')
    assertEquals(rpcNames(s.supabase), [
      'list_signature_requests_to_reconcile',
      'begin_signature_request_send',
      'mark_signature_request_failed',
      'record_signature_sync',
    ])
    assertEquals(s.fake.calls.length, 0)
  })
})

Deno.test('reconcileOrg: a draft with a document is settled after an hour (from its last send), one without after a day', async () => {
  await run(async () => {
    const s = cronSetup()
    // Two hours since its send (failed, claim released): listed; Documenso
    // completed it, so recovered.
    const completed = await sentRequest(s.fake, s.db, {
      status: 'draft',
      sent_at: null,
      expires_at: null,
      last_error: 'mark_sent_failed',
      created_at: '2026-10-05T12:00:00.000Z',
      last_send_at: '2026-10-08T10:00:00.000Z',
    })
    for (const signer of completed.signers) signer.recipient_id = null
    s.fake.complete(completed.envelope_id!)
    // Re-sent 30 minutes ago, still sending: not listed yet.
    await sentRequest(s.fake, s.db, {
      status: 'draft',
      sent_at: null,
      expires_at: null,
      created_at: '2026-10-05T12:00:00.000Z',
      send_started_at: '2026-10-08T11:30:00.000Z',
      last_send_at: '2026-10-08T11:30:00.000Z',
    })
    // Re-sent 30 minutes ago and failed (claim released): its last send
    // still counts, not its creation, so not listed yet either.
    await sentRequest(s.fake, s.db, {
      status: 'draft',
      sent_at: null,
      expires_at: null,
      last_error: 'provider_unavailable',
      created_at: '2026-10-05T12:00:00.000Z',
      last_send_at: '2026-10-08T11:30:00.000Z',
    })
    // No document, two hours old: not listed (a day for those).
    s.db.insertRequest({
      id: 'r-young',
      created_at: '2026-10-08T10:00:00.000Z',
    })
    let detail = ''
    const lines = await captureConsole('error', async () => {
      detail = await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    })
    assertEquals(detail, '1 demande suivie (1 signée)')
    assert(JSON.stringify(lines).includes('signing_source_missing'))
    assertEquals(
      await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal),
      'Aucune demande à suivre',
    )
    assertEquals(s.db.requests.get(completed.id)!.status, 'signed')
    assertEquals(s.db.requests.get('r-young')!.last_error, null)
  })
})

Deno.test('reconcileOrg: an overdue request no longer pending at Documenso (cancel answers 400) → expired, done', async () => {
  await run(async () => {
    const s = cronSetup()
    const row = await sentRequest(s.fake, s.db, {
      expires_at: '2026-10-07T12:00:00.000Z',
    })
    s.fake.failures.cancel = 400
    const detail = await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    assertEquals(detail, '1 demande suivie (1 expirée)')
    assertEquals(s.db.requests.get(row.id)!.status, 'expired')
  })
})

Deno.test('reconcileOrg: past the soft deadline no new batch starts; the detail says how many wait', async () => {
  await run(async () => {
    const s = cronSetup()
    for (let i = 0; i < 6; i++) await sentRequest(s.fake, s.db)
    let t = 0
    const perOrg = reconcileOrg({
      fetch: s.fake.fetch,
      now: s.clock.now,
      reach: LOCAL_REACH,
      softDeadlineMs: 1000,
      // The first batch takes the whole budget.
      elapsed: () => (t += 600),
    }, 'signing-sync')
    const detail = await perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    assertEquals(
      detail,
      '4 demandes suivies (4 inchangées) ; 2 à reprendre au prochain passage',
    )
  })
})

Deno.test('reconcileOrg: nothing to do → a short detail; a failed request → the run fails, reported with ids only', async () => {
  await run(async () => {
    const s = cronSetup()
    assertEquals(
      await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal),
      'Aucune demande à suivre',
    )
    const row = await sentRequest(s.fake, s.db)
    s.fake.failures.read = 500
    const lines = await captureConsole('error', async () => {
      const error = await assertRejects(() =>
        s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      )
      assertEquals((error as { code: string }).code, 'reconcile_failed')
    })
    const report = JSON.stringify(lines)
    assert(report.includes(row.id))
    assert(report.includes('provider_error'))
    assert(!report.includes('@'))
  })
})

Deno.test('isDocumensoOutage: Documenso unusable (key refused, no answer, redirect, a 404 not its own, 408, 429, 5xx, not configured) versus one bad request', () => {
  const documenso = (
    code: 'provider_error' | 'not_configured' | 'invalid_request',
    status: number | null,
    notFound = false,
  ) => new DocumensoError(code, status, 'x', null, notFound)
  for (
    const outage of [
      documenso('not_configured', 401),
      documenso('not_configured', null),
      documenso('provider_error', null),
      documenso('provider_error', 302),
      // A proxy's or another server's 404 (a wrong address), not Documenso's (E-14).
      documenso('provider_error', 404),
      documenso('provider_error', 408),
      documenso('provider_error', 429),
      documenso('provider_error', 503),
      // A 200 to a read that is no envelope (a wrong base URL serving a page).
      new DocumensoError('provider_error', 200, 'x', null, false, true),
      new SigningFailure('not_configured'),
    ]
  ) assert(isDocumensoOutage(outage), `${outage.code} ${outage.message}`)
  for (
    const own of [
      documenso('provider_error', 404, true),
      documenso('provider_error', 400),
      // Refused before any request (status null, but nothing was sent).
      documenso('invalid_request', null),
      // A signed PDF over the cap: refused while it streams, after a 200.
      documenso('provider_error', 200),
      new SigningFailure('signing_foreign_document'),
      new SigningFailure('apply_failed'),
      new Error('boom'),
    ]
  ) assert(!isDocumensoOutage(own), own.message)
})

Deno.test('reconcileOrg: one request deleted at Documenso (404) → the run is ok, the detail counts it, the others are read', async () => {
  await run(async () => {
    const s = cronSetup()
    const gone = await sentRequest(s.fake, s.db)
    const fine = await sentRequest(s.fake, s.db)
    s.fake.documents.delete(gone.envelope_id!)
    let detail = ''
    const lines = await captureConsole('error', async () => {
      detail = await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    })
    assertEquals(
      detail,
      '1 demande suivie (1 inchangée) ; 1 demande non vérifiée',
    )
    const report = JSON.stringify(lines)
    assert(report.includes(gone.id))
    assert(report.includes('provider_not_found'))
    assert(!report.includes(fine.id), 'only the failing request is reported')
    assertEquals(s.db.syncs.get(gone.id)!.error_code, 'provider_not_found')
    assertEquals(s.db.syncs.get(gone.id)!.synced_at, null)
    assertEquals(s.db.syncs.get(fine.id)!.synced_at, NOW)
    assertEquals(s.db.syncs.get(fine.id)!.error_code, null)
  })
})

Deno.test('reconcileOrg: the only request fails on its own (404) → still ok, not an outage', async () => {
  await run(async () => {
    const s = cronSetup()
    const gone = await sentRequest(s.fake, s.db)
    s.fake.documents.delete(gone.envelope_id!)
    await captureConsole('error', async () => {
      assertEquals(
        await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal),
        'Aucune demande traitée ; 1 demande non vérifiée',
      )
    })
  })
})

Deno.test('reconcileOrg: Documenso refuses the key for every request → reconcile_failed (an outage)', async () => {
  await run(async () => {
    const s = cronSetup()
    await sentRequest(s.fake, s.db)
    await sentRequest(s.fake, s.db)
    s.fake.failures.read = 401
    await captureConsole('error', async () => {
      const error = await assertRejects(() =>
        s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      )
      assertEquals((error as { code: string }).code, 'reconcile_failed')
    })
    for (const sync of s.db.syncs.values()) {
      assertEquals(sync.error_code, 'not_configured')
    }
  })
})

Deno.test('failureCode: a 404 and a 500 never read alike; our own codes kept; junk → internal', () => {
  const documenso = (
    code: 'provider_error' | 'not_configured' | 'invalid_request',
    status: number | null,
    notFound = false,
  ) => new DocumensoError(code, status, 'x', null, notFound)
  assertEquals(
    [
      documenso('provider_error', 404, true),
      documenso('provider_error', 400),
      documenso('provider_error', 410),
      documenso('invalid_request', null),
      documenso('provider_error', null),
      documenso('provider_error', 404),
      documenso('provider_error', 500),
      documenso('provider_error', 429),
      documenso('provider_error', 302),
      documenso('provider_error', 200),
      documenso('not_configured', 401),
      new SigningFailure('signing_foreign_document'),
      new SigningFailure('bad code!'),
      new Error('boom'),
      null,
    ].map(failureCode),
    [
      'provider_not_found',
      'provider_rejected',
      'provider_rejected',
      'provider_invalid_request',
      'provider_unreachable',
      'provider_error',
      'provider_error',
      'provider_error',
      'provider_error',
      'provider_error',
      'not_configured',
      'signing_foreign_document',
      'internal',
      'internal',
      'internal',
    ],
  )
})

Deno.test('isDocumentMissing: Documenso answered, not with the envelope (its own 404, another 4xx, another envelope) versus Documenso unusable or nothing sent', () => {
  const documenso = (
    code: 'provider_error' | 'not_configured' | 'invalid_request',
    status: number | null,
    notFound = false,
  ) => new DocumensoError(code, status, 'x', null, notFound)
  for (
    const gone of [
      documenso('provider_error', 404, true),
      documenso('provider_error', 400),
      new SigningFailure('signing_foreign_document'),
    ]
  ) assert(isDocumentMissing(gone), gone.message)
  for (
    const other of [
      // A 404 that is not Documenso's: the address is wrong (an outage).
      documenso('provider_error', 404),
      documenso('invalid_request', null),
      documenso('not_configured', 401),
      documenso('provider_error', null),
      documenso('provider_error', 408),
      documenso('provider_error', 429),
      documenso('provider_error', 500),
      documenso('provider_error', 200),
      new SigningFailure('apply_failed'),
      new Error('boom'),
    ]
  ) assert(!isDocumentMissing(other), other.message)
})

Deno.test('reconcileOrg: every read answers 404 (a key of another team, a VM rebuilt without its documents) → reconcile_documents_missing, not ok', async () => {
  await run(async () => {
    const s = cronSetup()
    const rows = [
      await sentRequest(s.fake, s.db),
      await sentRequest(s.fake, s.db),
    ]
    for (const row of rows) s.fake.documents.delete(row.envelope_id!)
    await captureConsole('error', async () => {
      const error = await assertRejects(() =>
        s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      )
      assertEquals(
        (error as { code: string }).code,
        'reconcile_documents_missing',
      )
    })
    for (const row of rows) {
      assertEquals(s.db.syncs.get(row.id)!.error_code, 'provider_not_found')
    }
  })
})

Deno.test("reconcileOrg: every read answers a 404 that is not Documenso's (another server at the address) → reconcile_failed, not documents missing", async () => {
  await run(async () => {
    const s = cronSetup()
    await sentRequest(s.fake, s.db)
    await sentRequest(s.fake, s.db)
    // A proxy's page, not Documenso's NOT_FOUND (E-14: notFound stays false).
    const elsewhere: typeof fetch = () =>
      Promise.resolve(
        new Response('<html>Not Found</html>', {
          status: 404,
          headers: { 'Content-Type': 'text/html' },
        }),
      )
    const perOrg = reconcileOrg(
      { fetch: elsewhere, now: s.clock.now, reach: LOCAL_REACH },
      'signing-sync',
    )
    await captureConsole('error', async () => {
      const error = await assertRejects(() =>
        perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      )
      assertEquals((error as { code: string }).code, 'reconcile_failed')
    })
    assertEquals(s.db.syncs.size, 2)
    for (const sync of s.db.syncs.values()) {
      assertEquals(sync.error_code, 'provider_error')
    }
  })
})

Deno.test('reconcileOrg: overdue requests whose cancel Documenso answers 404 though the read-back finds them (E-8) → the run is ok: they were read', async () => {
  await run(async () => {
    const s = cronSetup()
    const rows = [
      await sentRequest(s.fake, s.db, {
        expires_at: '2026-10-07T12:00:00.000Z',
      }),
      await sentRequest(s.fake, s.db, {
        expires_at: '2026-10-07T12:00:00.000Z',
      }),
    ]
    s.fake.failures.cancel = 404
    let detail = ''
    await captureConsole('error', async () => {
      detail = await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    })
    assertEquals(detail, 'Aucune demande traitée ; 2 demandes non vérifiées')
    for (const row of rows) {
      assertEquals(s.db.syncs.get(row.id)!.error_code, 'provider_not_found')
      assertEquals(s.db.requests.get(row.id)!.status, 'expired')
    }
  })
})

Deno.test('reconcileOrg: stale drafts whose delete Documenso answers 404 though the read-back finds them (E-8) → the run is ok, each released with its code', async () => {
  await run(async () => {
    const s = cronSetup()
    const rows = []
    for (let i = 0; i < 2; i++) {
      const row = await deadDraft(s, false)
      s.fake.documents.get(row.envelope_id!)!.status = 'DRAFT'
      rows.push(row)
    }
    s.fake.failures.delete = 404
    s.clock.advance(2 * 3_600_000)
    let detail = ''
    await captureConsole('error', async () => {
      detail = await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    })
    assertEquals(detail, 'Aucune demande traitée ; 2 demandes non vérifiées')
    for (const row of rows) {
      assertEquals(s.db.syncs.get(row.id)!.error_code, 'provider_not_found')
      const draft = s.db.requests.get(row.id)!
      assertEquals([draft.status, draft.last_error], [
        'draft',
        'provider_not_found',
      ])
      assertEquals(s.fake.documents.get(row.envelope_id!)!.status, 'DRAFT')
    }
  })
})

Deno.test('reconcileOrg: every document is another one under its id (an instance rebuilt, ids reused) → reconcile_documents_missing', async () => {
  await run(async () => {
    const s = cronSetup()
    for (let i = 0; i < 2; i++) {
      const row = await sentRequest(s.fake, s.db)
      s.fake.documents.get(row.envelope_id!)!.externalId = `other-${i}`
    }
    await captureConsole('error', async () => {
      const error = await assertRejects(() =>
        s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      )
      assertEquals(
        (error as { code: string }).code,
        'reconcile_documents_missing',
      )
    })
  })
})

Deno.test('reconcileOrg: a draft skipped as sending is not a read: with every other read a 404, still an outage', async () => {
  await run(async () => {
    const s = cronSetup()
    const draft = await sentRequest(s.fake, s.db, {
      status: 'draft',
      sent_at: null,
      expires_at: null,
      created_at: NOW,
    })
    const gone = [
      await sentRequest(s.fake, s.db),
      await sentRequest(s.fake, s.db),
    ]
    for (const row of gone) s.fake.documents.delete(row.envelope_id!)
    // Two hours later the draft is listed, but a send claimed it 5 minutes ago.
    s.clock.advance(2 * 3_600_000)
    s.db.requests.get(draft.id)!.send_started_at = new Date(
      s.clock.now().getTime() - 5 * 60_000,
    ).toISOString()
    await captureConsole('error', async () => {
      const error = await assertRejects(() =>
        s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      )
      assertEquals(
        (error as { code: string }).code,
        'reconcile_documents_missing',
      )
    })
    assertEquals(s.db.requests.get(draft.id)!.status, 'draft', 'left alone')
  })
})

/** A fetch that answers every read of `envelopes` (all when null) with a 200 HTML page. */
function pageAt(
  envelopes: string[] | null,
  fallback: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const path = new URL(new Request(input, init).url).pathname
    const hit = envelopes === null
      ? path.startsWith('/api/v2/envelope/')
      : envelopes.some((id) => path.endsWith(`/${id}`))
    return hit
      ? Promise.resolve(
        new Response('<html>Bienvenue</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      )
      : fallback(input, init)
  }
}

Deno.test('reconcileOrg: every read answers a 200 that is no envelope (a wrong base URL serving a page) → reconcile_failed', async () => {
  await run(async () => {
    const s = cronSetup()
    await sentRequest(s.fake, s.db)
    await sentRequest(s.fake, s.db)
    const perOrg = reconcileOrg(
      {
        fetch: pageAt(null, s.fake.fetch),
        now: s.clock.now,
        reach: LOCAL_REACH,
      },
      'signing-sync',
    )
    await captureConsole('error', async () => {
      const error = await assertRejects(() =>
        perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      )
      assertEquals((error as { code: string }).code, 'reconcile_failed')
    })
    assertEquals(s.db.syncs.size, 2)
    for (const sync of s.db.syncs.values()) {
      assertEquals([sync.error_code, sync.synced_at], ['provider_error', null])
    }
  })
})

Deno.test('reconcileOrg: one read answers a 200 that is no envelope among real reads → partial, the run is ok', async () => {
  await run(async () => {
    const s = cronSetup()
    const odd = await sentRequest(s.fake, s.db)
    const fine = await sentRequest(s.fake, s.db)
    const perOrg = reconcileOrg(
      {
        fetch: pageAt([odd.envelope_id!], s.fake.fetch),
        now: s.clock.now,
        reach: LOCAL_REACH,
      },
      'signing-sync',
    )
    let detail = ''
    await captureConsole('error', async () => {
      detail = await perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    })
    assertEquals(
      detail,
      '1 demande suivie (1 inchangée) ; 1 demande non vérifiée',
    )
    assertEquals(s.db.syncs.get(odd.id)!.error_code, 'provider_error')
    assertEquals(s.db.syncs.get(fine.id)!.synced_at, NOW)
  })
})

Deno.test('reconcileOrg: a draft skipped as sending is recorded as an attempt only: its last read and failure streak stay', async () => {
  await run(async () => {
    const s = cronSetup()
    const draft = await deadDraft(s, false)
    const before = {
      attempted_at: '2026-10-08T10:00:00.000Z',
      synced_at: '2026-10-08T05:00:00.000Z',
      error_code: 'provider_unreachable',
      failing_since: '2026-10-08T06:00:00.000Z',
      reported: {},
    }
    s.db.syncs.set(draft.id, { ...before })
    // Two hours later the draft is listed, but a send claimed it 5 minutes ago.
    s.clock.advance(2 * 3_600_000)
    s.db.requests.get(draft.id)!.send_started_at = new Date(
      s.clock.now().getTime() - 5 * 60_000,
    ).toISOString()
    assertEquals(
      await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal),
      '1 demande suivie (1 en cours d’envoi)',
    )
    assertEquals(s.db.syncs.get(draft.id), {
      ...before,
      attempted_at: s.clock.now().toISOString(),
    })
    assertEquals(
      s.supabase.calls.find((c) => c.fn === 'record_signature_sync')?.args,
      {
        p_org_id: SIGNING_ORG,
        p_id: draft.id,
        p_error_code: null,
        p_read: false,
        p_report_codes: [],
      },
    )
  })
})

Deno.test('reconcileOrg: a request settled without a Documenso read (a draft with no envelope, abandoned) is no read: the attempt only', async () => {
  await run(async () => {
    const s = cronSetup()
    s.db.insertRequest({ id: 'r1', created_at: '2026-10-06T12:00:00.000Z' })
    assertEquals(
      await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal),
      '1 demande suivie (1 abandonnée)',
    )
    const sync = s.db.syncs.get('r1')!
    assertEquals(
      [sync.attempted_at, sync.synced_at, sync.error_code, sync.failing_since],
      [NOW, null, null, null],
    )
  })
})

Deno.test('reconcileOrg: a read records a success (p_read true)', async () => {
  await run(async () => {
    const s = cronSetup()
    const row = await sentRequest(s.fake, s.db)
    await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    assertEquals(
      s.supabase.calls.find((c) => c.fn === 'record_signature_sync')?.args
        .p_read,
      true,
    )
    assertEquals(s.db.syncs.get(row.id)!.synced_at, NOW)
  })
})

Deno.test('reconcileOrg: when record_signature_sync fails, every report goes out, unthrottled', async () => {
  await run(async () => {
    const s = cronSetup()
    const gone = await sentRequest(s.fake, s.db)
    await sentRequest(s.fake, s.db)
    s.fake.documents.delete(gone.envelope_id!)
    s.db.rpc.record_signature_sync = () => ({
      error: { code: 'XX000', message: 'boom' },
    })
    const reports = async () => {
      const lines = await captureConsole('error', async () => {
        await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      })
      return lines.filter((l) => JSON.stringify(l).includes(gone.id)).length
    }
    assertEquals(await reports(), 1, 'reported')
    s.clock.advance(3_600_000)
    assertEquals(
      await reports(),
      1,
      'an hour later: reported again (no record, no throttle)',
    )
  })
})

Deno.test('reconcileOrg: a request that keeps failing is reported to Sentry once a day, not every hour', async () => {
  await run(async () => {
    const s = cronSetup()
    const gone = await sentRequest(s.fake, s.db)
    await sentRequest(s.fake, s.db)
    s.fake.documents.delete(gone.envelope_id!)
    const reports = async () => {
      const lines = await captureConsole('error', async () => {
        await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      })
      return lines.filter((l) => JSON.stringify(l).includes(gone.id)).length
    }
    assertEquals(await reports(), 1, 'first failure: reported')
    s.clock.advance(3_600_000)
    assertEquals(await reports(), 0, 'an hour later, same code: not again')
    assertEquals(
      s.db.syncs.get(gone.id)!.failing_since,
      NOW,
      'still failing since the first attempt',
    )
    s.clock.advance(23 * 3_600_000)
    assertEquals(await reports(), 1, 'a day after the report: once more')
  })
})

Deno.test('reconcileOrg: an orphan completed draft is reported once a day, not at every run', async () => {
  await run(async () => {
    const s = cronSetup()
    const row = await deadDraft(s, false)
    s.fake.complete(row.envelope_id!)
    s.fake.documents.get(row.envelope_id!)!.recipients[1]
      .signingOrder = 5
    const orphanReports = async () => {
      const lines = await captureConsole('error', async () => {
        await s.perOrg(SIGNING_ORG, s.supabase.client, s.signal)
      })
      return lines.filter((l) =>
        JSON.stringify(l).includes('signing_orphan_completed')
      ).length
    }
    // Listed an hour after its last send (each settle claims it again).
    s.clock.advance(2 * 3_600_000)
    assertEquals(await orphanReports(), 1)
    assertEquals(s.db.requests.get(row.id)!.last_error, 'orphan_completed')
    s.clock.advance(2 * 3_600_000)
    assertEquals(await orphanReports(), 0, 'two hours later: not again')
    assertEquals(
      s.db.syncs.get(row.id)!.error_code,
      null,
      'a read, not a failure',
    )
    s.clock.advance(22 * 3_600_000)
    assertEquals(await orphanReports(), 1, 'over a day later: once more')
  })
})

Deno.test('reconcileOrg: a fair rotation: what a run left past its soft deadline comes first at the next', async () => {
  await run(async () => {
    const s = cronSetup()
    const rows = []
    for (let i = 0; i < 6; i++) rows.push(await sentRequest(s.fake, s.db))
    let t = 0
    const perOrg = reconcileOrg({
      fetch: s.fake.fetch,
      now: s.clock.now,
      reach: LOCAL_REACH,
      softDeadlineMs: 1000,
      // Each batch takes the whole budget: one batch (4 requests) per run.
      elapsed: () => (t += 600),
    }, 'signing-sync')
    await perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    const first = rows.filter((r) => s.db.syncs.has(r.id)).map((r) => r.id)
    assertEquals(first.length, 4)
    s.clock.advance(3_600_000)
    t = 0
    s.fake.calls.length = 0
    await perOrg(SIGNING_ORG, s.supabase.client, s.signal)
    const read = s.fake.calls.map((c) => new URL(c.url).pathname)
    const left = rows.filter((r) => !first.includes(r.id))
      .map((r) => `/api/v2/envelope/${r.envelope_id}`)
    assertEquals(read.slice(0, 2).sort(), left.sort(), 'the two left first')
    assertEquals(read.length, 4)
  })
})
