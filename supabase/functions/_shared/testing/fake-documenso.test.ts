import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  type CreateEnvelopeInput,
  documensoClient,
  DocumensoError,
  ENVELOPE_ID,
} from '../documenso.ts'
import { fakeDocumenso } from './fake-documenso.ts'
import { fakeFetch } from './fake-fetch.ts'
import { LOCAL_REACH } from './signing-fixtures.ts'

const BASE = 'http://host.docker.internal:55390'
const KEY = 'local-dev-documenso-key'
const WEBHOOK = 'http://127.0.0.1:55321/functions/v1/signing-webhook?org=o'
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n%%EOF\n')
const FIRST = 'envelope_aaaaaaaaaaaaaaab'

const signature = {
  type: 'SIGNATURE' as const,
  page: 1,
  x: 10,
  y: 70,
  width: 30,
  height: 6,
}

const input: CreateEnvelopeInput = {
  title: 'Document test',
  externalId: 'req-1',
  recipients: [
    {
      email: 'pro@mana.test',
      name: 'Pro',
      role: 'SIGNER',
      signingOrder: 1,
      fields: [signature],
    },
    {
      email: 'clinique@mana.test',
      name: 'Clinique',
      role: 'SIGNER',
      signingOrder: 2,
      fields: [{ ...signature, x: 55 }],
    },
  ],
  meta: {
    subject: 'Sujet',
    message: 'Message',
    language: 'fr',
    distributionMethod: 'EMAIL',
    signingOrder: 'SEQUENTIAL',
    timezone: 'America/Toronto',
  },
}

/** A fake with one distributed envelope; returns its ids. */
async function sent(fake = fakeDocumenso()) {
  const client = documensoClient(BASE, KEY, fake.fetch, { reach: LOCAL_REACH })
  const { envelopeId, recipients } = await client.createEnvelope(PDF, input)
  await client.distribute(envelopeId)
  return { fake, client, envelopeId, ids: recipients.map((r) => r.id) }
}

/** A raw API call to the fake, as Documenso's clients make them. */
const call = (
  fake: ReturnType<typeof fakeDocumenso>,
  path: string,
  json: unknown,
) =>
  fake.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  })

Deno.test('fake-documenso: the client round trip (create with inline fields, distribute, sign, complete, download)', async () => {
  const { fake, client, envelopeId, ids } = await sent()
  assertEquals(envelopeId, FIRST)
  assert(ENVELOPE_ID.test(envelopeId))
  assertEquals(ids, ['101', '102'])
  const doc = fake.documents.get(envelopeId)!
  assertEquals(doc.legacyId, 1)
  assertEquals(doc.items, [{ id: 'envelope_item_aaaaaaaaaaaaaaab' }])
  assertEquals(doc.fields, [
    {
      recipientId: '101',
      type: 'SIGNATURE',
      identifier: 0,
      page: 1,
      positionX: 10,
      positionY: 70,
      width: 30,
      height: 6,
    },
    {
      recipientId: '102',
      type: 'SIGNATURE',
      identifier: 0,
      page: 1,
      positionX: 55,
      positionY: 70,
      width: 30,
      height: 6,
    },
  ])
  const read = await client.get(envelopeId)
  assertEquals(read.status, 'PENDING')
  assertEquals(read.externalId, 'req-1', 'the externalId round-trips')

  fake.open(envelopeId)
  fake.sign(envelopeId)
  const afterSign = await client.get(envelopeId)
  assertEquals(afterSign.status, 'PENDING')
  assertEquals(afterSign.recipients.map((r) => r.signingStatus), [
    'SIGNED',
    'NOT_SIGNED',
  ])

  fake.complete(envelopeId)
  const done = await client.get(envelopeId)
  assertEquals(done.status, 'COMPLETED')
  assert(done.completedAt)

  const signed = await client.downloadSigned(envelopeId)
  assertEquals(signed.subarray(0, PDF.length), PDF)
  assert(signed.length > PDF.length)
  assertEquals(doc.meta.dateFormat, 'dd/MM/yyyy')
  assertEquals(doc.meta.emailSettings, { ownerRecipientExpired: false })
  // The next envelope's id counts on in Documenso's alphabet.
  const next = await client.createEnvelope(PDF, input)
  assertEquals(next.envelopeId, 'envelope_aaaaaaaaaaaaaaac')
})

Deno.test('fake-documenso: a wrong key → 401 (ping); a signer without a SIGNATURE field cannot be distributed; a bad field fails the create', async () => {
  const fake = fakeDocumenso()
  assertEquals(
    await documensoClient(BASE, 'wrong', fake.fetch, { reach: LOCAL_REACH })
      .ping(),
    { ok: false, status: 401 },
  )
  const client = documensoClient(BASE, KEY, fake.fetch, { reach: LOCAL_REACH })
  assertEquals(await client.ping(), { ok: true })
  const { envelopeId } = await client.createEnvelope(PDF, {
    ...input,
    recipients: [input.recipients[0], { ...input.recipients[1], fields: [] }],
  })
  const error = await assertRejects(
    () => client.distribute(envelopeId),
    DocumensoError,
  )
  assertEquals(error.status, 400)

  for (
    const field of [
      { ...signature, page: 0 },
      { ...signature, x: 101 },
      { ...signature, width: 0 },
    ]
  ) {
    const refused = await assertRejects(
      () =>
        client.createEnvelope(PDF, {
          ...input,
          recipients: [{ ...input.recipients[0], fields: [field] }],
        }),
      DocumensoError,
    )
    assertEquals([refused.status, refused.envelopeId], [400, null])
  }
  assertEquals(fake.documents.size, 1, 'a refused field creates nothing')
})

Deno.test('fake-documenso: create refuses a field naming another file, a second file or another type', async () => {
  const fake = fakeDocumenso()
  const form = (payload: unknown, files = 1) => {
    const data = new FormData()
    data.append('payload', JSON.stringify(payload))
    for (let i = 0; i < files; i++) {
      data.append('files', new Blob([PDF]), 'document.pdf')
    }
    return fake.fetch(`${BASE}/api/v2/envelope/create`, {
      method: 'POST',
      headers: { Authorization: KEY },
      body: data,
    })
  }
  const recipient = {
    email: 'pro@mana.test',
    name: 'Pro',
    role: 'SIGNER',
    fields: [{
      identifier: 1,
      type: 'SIGNATURE',
      page: 1,
      positionX: 1,
      positionY: 1,
      width: 5,
      height: 5,
    }],
  }
  const base = { title: 'T', type: 'DOCUMENT', recipients: [recipient] }
  assertEquals((await form(base)).status, 400)
  const fine = {
    ...base,
    recipients: [{
      ...recipient,
      fields: [{ ...recipient.fields[0], identifier: 0 }],
    }],
  }
  assertEquals((await form(fine, 2)).status, 400)
  assertEquals((await form({ ...fine, type: 'TEMPLATE' })).status, 400)
  const ok = await form(fine)
  assertEquals([ok.status, await ok.json()], [200, { id: FIRST }])
})

Deno.test('fake-documenso: delete — a draft disappears, then a NOT_FOUND 404 (resolved by the client); a pending one is refused', async () => {
  const fake = fakeDocumenso()
  const client = documensoClient(BASE, KEY, fake.fetch, { reach: LOCAL_REACH })
  const draft = await client.createEnvelope(PDF, input)
  await client.cancel(draft.envelopeId, { draft: true })
  assert(!fake.documents.has(draft.envelopeId))
  await client.cancel(draft.envelopeId, { draft: true })
  const gone = await call(fake, '/api/v2/envelope/delete', {
    envelopeId: draft.envelopeId,
  })
  assertEquals([gone.status, (await gone.json()).code], [404, 'NOT_FOUND'])

  const { envelopeId } = await sent(fake)
  const refused = await call(fake, '/api/v2/envelope/delete', { envelopeId })
  assertEquals(refused.status, 400)
  assertEquals(fake.documents.get(envelopeId)?.status, 'PENDING')
})

Deno.test('fake-documenso: cancel — pending → CANCELLED and kept, reported once to onEvent; again → the read-back; completed → 400; a draft → deleted', async () => {
  const events: string[] = []
  const fake = fakeDocumenso({
    onEvent: (event, id) => events.push(`${event}:${id}`),
  })
  const { client, envelopeId } = await sent(fake)
  await client.cancel(envelopeId, { reason: 'Remplacé' })
  assertEquals((await client.get(envelopeId)).status, 'CANCELLED')
  // Again: Documenso refuses (400), the client reads CANCELLED back.
  await client.cancel(envelopeId)
  await Promise.resolve()
  assertEquals(events, [`DOCUMENT_CANCELLED:${envelopeId}`])

  const second = await sent(fake)
  fake.complete(second.envelopeId)
  const error = await assertRejects(
    () => client.cancel(second.envelopeId),
    DocumensoError,
  )
  assertEquals(error.status, 400)
  assertEquals(fake.documents.get(second.envelopeId)?.status, 'COMPLETED')

  // A draft cancelled without `draft`: 400, read back DRAFT, deleted.
  const draft = await client.createEnvelope(PDF, input)
  await client.cancel(draft.envelopeId)
  assert(!fake.documents.has(draft.envelopeId))
  assertEquals(
    fake.calls.slice(-3).map((c) => `${c.method} ${new URL(c.url).pathname}`),
    [
      'POST /api/v2/envelope/cancel',
      `GET /api/v2/envelope/${draft.envelopeId}`,
      'POST /api/v2/envelope/delete',
    ],
  )
})

Deno.test('fake-documenso: the expiry reaches the stored meta', async () => {
  const fake = fakeDocumenso()
  const client = documensoClient(BASE, KEY, fake.fetch, { reach: LOCAL_REACH })
  const { envelopeId } = await client.createEnvelope(PDF, {
    ...input,
    meta: { ...input.meta, expiryDays: 30 },
  })
  assertEquals(
    fake.documents.get(envelopeId)?.meta.envelopeExpirationPeriod,
    { unit: 'day', amount: 30 },
  )
})

Deno.test('fake-documenso: reject stores the reason; redistribute needs a pending envelope; distribute answers tokens and signing URLs', async () => {
  const { fake, client, envelopeId, ids } = await sent()
  await client.redistribute(envelopeId, [ids[0]])
  const answer = await call(fake, '/api/v2/envelope/distribute', { envelopeId })
  const body = await answer.json()
  assertEquals(body.id, envelopeId)
  assert(
    body.recipients.every((r: Record<string, unknown>) =>
      r.token && r.signingUrl
    ),
  )
  fake.reject(envelopeId, undefined, 'Non merci')
  const doc = await client.get(envelopeId)
  assertEquals(doc.status, 'REJECTED')
  assertEquals(doc.recipients[0].rejectionReason, 'Non merci')
  await assertRejects(
    () => client.redistribute(envelopeId, [ids[1]]),
    DocumensoError,
  )
  assertThrows(() => fake.complete(envelopeId))
})

Deno.test('fake-documenso: failures inject a status per operation until removed', async () => {
  const fake = fakeDocumenso()
  const client = documensoClient(BASE, KEY, fake.fetch, { reach: LOCAL_REACH })
  const { envelopeId } = await client.createEnvelope(PDF, input)
  fake.failures.distribute = 500
  const error = await assertRejects(
    () => client.distribute(envelopeId),
    DocumensoError,
  )
  assertEquals([error.code, error.status], ['provider_error', 500])
  assertEquals((await client.get(envelopeId)).status, 'DRAFT')
  delete fake.failures.distribute
  await client.distribute(envelopeId)
  assertEquals((await client.get(envelopeId)).status, 'PENDING')
})

Deno.test("fake-documenso: an externalId set to undefined is left out of reads → the client's bad response", async () => {
  const { fake, client, envelopeId } = await sent()
  fake.documents.get(envelopeId)!.externalId = undefined
  const error = await assertRejects(
    () => client.get(envelopeId),
    DocumensoError,
  )
  assertEquals([error.code, error.status], ['provider_error', 200])
  fake.documents.get(envelopeId)!.externalId = null
  assertEquals((await client.get(envelopeId)).externalId, null)
})

Deno.test('fake-documenso: the webhook request carries the secret, the event, the envelope and external ids, the legacy fields and a ticking version', async () => {
  const { fake, envelopeId } = await sent()
  fake.open(envelopeId)
  const first = fake.webhookRequest(WEBHOOK, 'DOCUMENT_OPENED', envelopeId)
  const second = fake.webhookRequest(WEBHOOK, 'DOCUMENT_OPENED', envelopeId)
  assertEquals(first.url, WEBHOOK)
  assertEquals(
    first.headers.get('x-documenso-secret'),
    'local-dev-documenso-webhook-secret',
  )
  const a = await first.json()
  const b = await second.json()
  assertEquals(a.event, 'DOCUMENT_OPENED')
  assertEquals(a.payload.id, 1, 'the legacy numeric id, as Documenso sends it')
  assertEquals(a.payload.envelopeId, envelopeId)
  assertEquals(a.payload.externalId, 'req-1')
  assertEquals(a.payload.recipients[0].readStatus, 'OPENED')
  assertEquals(a.payload.recipients[0].token, 'token-101')
  assertEquals(a.payload.recipients[0].documentId, 1)
  assertEquals(a.payload.Recipient, a.payload.recipients)
  assert(a.createdAt !== b.createdAt)
})

Deno.test('fake-documenso: in-flight requests are counted; other origins go to the fallback', async () => {
  const other = fakeFetch({
    'GET http://storage.test/x': () => new Response('ok'),
  })
  const fake = fakeDocumenso({ latencyMs: 5, fallback: other.fetch })
  const client = documensoClient(BASE, KEY, fake.fetch, { reach: LOCAL_REACH })
  await Promise.all([client.ping(), client.ping(), client.ping()])
  assertEquals(fake.inFlight, { current: 0, max: 3 })
  assertEquals(await (await fake.fetch('http://storage.test/x')).text(), 'ok')
  assertEquals(fake.calls.length, 3)
})
