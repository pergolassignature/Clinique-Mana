import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  applyEvents,
  documentEvents,
  normaliseEventName,
  orgSigning,
  reconcileOrg,
  storeSignedPdf,
  syncRequest,
  webhookEvents,
} from './signing-events.ts'
import { documensoClient } from './documenso.ts'
import { fakeDocumenso } from './testing/fake-documenso.ts'
import { fakeSigningDb } from './testing/fake-signing-db.ts'
import { fakeSupabase } from './testing/fake-supabase.ts'
import { fixedClock } from './testing/fixed-clock.ts'
import { captureConsole, withEnv } from './testing/env.ts'
import {
  DOCUMENSO_KEY,
  sentRequest,
  SIGNERS,
  SIGNING_ORG,
} from './testing/signing-fixtures.ts'
import { sha256Hex } from './storage.ts'

const NOW = '2026-10-08T12:00:00.000Z'
const run = (fn: () => Promise<void>) => withEnv({ SENTRY_DSN: undefined }, fn)

function setup(options: { latencyMs?: number } = {}) {
  const clock = fixedClock(NOW)
  const fake = fakeDocumenso({ latencyMs: options.latencyMs })
  const db = fakeSigningDb({ orgId: SIGNING_ORG, now: clock.now })
  const supabase = fakeSupabase({ rpc: db.rpc, storage: db.storage })
  const documenso = documensoClient(fake.baseUrl, DOCUMENSO_KEY, fake.fetch)
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
Deno.test('applyEvents: in order, the first call by document id, the next by request id', async () => {
  const { fake, db, supabase } = setup()
  const row = await sentRequest(fake, db)
  const recipient = row.signers[0].recipient_id
  const result = await applyEvents(
    supabase.client,
    SIGNING_ORG,
    { requestId: null, documentId: row.documenso_document_id },
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
  assertEquals(supabase.calls.map((c) => c.args.p_request_id), [null, row.id])
  assertEquals(db.requests.get(row.id)!.signers[0].status, 'signed')
})

Deno.test('applyEvents: retry and not_found stop at once; nothing to apply is ignored', async () => {
  const { db, supabase } = setup()
  db.insertRequest({ id: 'r1', documenso_document_id: '77' })
  const event = {
    event: 'DOCUMENT_COMPLETED',
    recipientId: null,
    at: null,
    reason: null,
  }
  assertEquals(
    (await applyEvents(supabase.client, SIGNING_ORG, {
      requestId: 'r1',
      documentId: '77',
    }, [event, event])).outcome,
    'retry',
  )
  assertEquals(supabase.calls.length, 1)
  assertEquals(
    (await applyEvents(supabase.client, SIGNING_ORG, {
      requestId: null,
      documentId: '999',
    }, [event])).outcome,
    'not_found',
  )
  assertEquals(
    await applyEvents(supabase.client, SIGNING_ORG, {
      requestId: null,
      documentId: '999',
    }, []),
    { outcome: 'ignored', requestId: null, needsDownload: false },
  )
})

Deno.test('applyEvents: an RPC error throws a coded failure', async () => {
  const supabase = fakeSupabase({
    rpc: { apply_signing_event: { error: { code: '57014' } } },
  })
  const error = await assertRejects(() =>
    applyEvents(supabase.client, SIGNING_ORG, {
      requestId: 'r',
      documentId: null,
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
Deno.test('orgSigning: the settings and the key in parallel; either missing → null', async () => {
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
    const signing = await orgSigning(supabase.client, SIGNING_ORG, fetch)
    assertEquals(signing !== null, configured)
    assertEquals(rpcNames(supabase), ['get_signing_context', 'get_org_secret'])
    assertEquals(supabase.calls[0].args.p_template_version_id, null)
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
  fake.complete(row.documenso_document_id!)
  await storeSignedPdf(supabase.client, documenso, SIGNING_ORG, {
    id: row.id,
    documentId: row.documenso_document_id!,
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
  fake.complete(row.documenso_document_id!)
  const supabase = fakeSupabase({
    rpc: db.rpc,
    storage: { upload: () => ({ error: { message: 'boom' } }) },
  })
  const error = await assertRejects(() =>
    storeSignedPdf(supabase.client, documenso, SIGNING_ORG, {
      id: row.id,
      documentId: row.documenso_document_id!,
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
      documentId: '1',
      viewPermission: 'settings.integrations_manage',
    })
  )
  assertEquals((error as { code: string }).code, 'signed_pdf_invalid')
  assertEquals(supabase.calls.length, 0)
  assertEquals(db.files.size, 0)
})

// ---------------------------------------------------------------------------
// syncRequest
// ---------------------------------------------------------------------------
Deno.test('syncRequest: a lost completion → events applied, signed PDF stored', async () => {
  await run(async () => {
    const { fake, db, supabase, ctx } = setup()
    const row = await sentRequest(fake, db)
    fake.complete(row.documenso_document_id!)
    assertEquals(await syncRequest(ctx, row, { settleDrafts: false }), 'signed')
    assertEquals(db.requests.get(row.id)!.status, 'signed')
    assert(rpcNames(supabase).includes('get_signing_request'))
  })
})

Deno.test('syncRequest: an opened document → viewed; nothing new → unchanged', async () => {
  const { fake, db, ctx } = setup()
  const row = await sentRequest(fake, db)
  fake.open(row.documenso_document_id!)
  assertEquals(await syncRequest(ctx, row, { settleDrafts: false }), 'updated')
  assertEquals(db.requests.get(row.id)!.status, 'viewed')
  assertEquals(
    await syncRequest(ctx, db.requests.get(row.id)!, { settleDrafts: false }),
    'unchanged',
  )
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

Deno.test('syncRequest: a draft Documenso completed, its PDF still staged → marked sent (roles by signing order), then signed', async () => {
  await run(async () => {
    const s = setup()
    const row = await deadDraft(s, true)
    s.fake.complete(row.documenso_document_id!)
    assertEquals(
      await syncRequest(s.ctx, row, { settleDrafts: false }),
      'signed',
    )
    const sent = s.supabase.calls.find((c) =>
      c.fn === 'mark_signature_request_sent'
    )!
    const docRecipients = s.fake.documents.get(row.documenso_document_id!)!
      .recipients
    assertEquals(sent.args.p_source_file_id, 'f-src')
    assertEquals(sent.args.p_signer_recipients, [
      { role: 'professional', recipient_id: docRecipients[0].id },
      { role: 'clinic', recipient_id: docRecipients[1].id },
    ])
    assertEquals(sent.args.p_expires_at, '2026-10-15T12:00:00.000Z')
    assertEquals(s.db.requests.get(row.id)!.status, 'signed')
    assertEquals(
      s.fake.calls.filter((c) =>
        c.url.includes('cancel') || c.url.includes('delete')
      ),
      [],
    )
  })
})

Deno.test('syncRequest: a draft Documenso completed, its PDF no longer staged → signing_orphan_completed (ids only), never cancelled', async () => {
  await run(async () => {
    const s = setup()
    const row = await deadDraft(s, false)
    s.fake.complete(row.documenso_document_id!)
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
    assertEquals(s.db.requests.get(row.id)!.status, 'draft')
    assertEquals(s.db.requests.get(row.id)!.last_error, null)
    assertEquals(
      s.fake.calls.filter((c) => c.method === 'POST'),
      [],
      'no cancel at Documenso',
    )
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
    s.fake.documents.get(row.documenso_document_id!)!.status,
    'PENDING',
  )
  assertEquals(
    await syncRequest(s.ctx, row, { settleDrafts: true }),
    'abandoned',
  )
  assertEquals(
    s.fake.documents.get(row.documenso_document_id!)!.status,
    'CANCELLED',
  )
  assertEquals(s.db.requests.get(row.id)!.last_error, 'abandoned')
})

Deno.test('syncRequest: a stale draft whose document is gone at Documenso → abandoned', async () => {
  const s = setup()
  const row = s.db.insertRequest({ id: 'r1', documenso_document_id: '404' })
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
  const deps = { fetch: s.fake.fetch, now: s.clock.now }
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
    s.fake.complete(row.documenso_document_id!)
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
    s.fake.open(row.documenso_document_id!)
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
      { fetch: traced, now: s.clock.now },
      'signing-sync',
    )
    const detail = await perOrg(SIGNING_ORG, client, s.signal)
    assertEquals(detail, '1 demande suivie (1 expirée)')
    const doc = row.documenso_document_id!
    assertEquals(order.filter((o) => !o.startsWith('get_')), [
      'list_signature_requests_to_reconcile',
      `documenso /api/v2/document/${doc}`,
      'apply_signing_event',
      'expire_signature_request',
      'documenso /api/v2/envelope/cancel',
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
      'mark_signature_request_failed',
    ])
    assertEquals(s.fake.calls.length, 0)
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
