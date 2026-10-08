import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  type CreateDocumentInput,
  documensoClient,
  DocumensoError,
} from '../documenso.ts'
import { fakeDocumenso } from './fake-documenso.ts'
import { fakeFetch } from './fake-fetch.ts'

const BASE = 'http://host.docker.internal:55390'
const KEY = 'local-dev-documenso-key'
const WEBHOOK = 'http://127.0.0.1:55321/functions/v1/signing-webhook?org=o'
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n%%EOF\n')

const input: CreateDocumentInput = {
  title: 'Document test',
  externalId: 'req-1',
  recipients: [
    { email: 'pro@mana.test', name: 'Pro', role: 'SIGNER', signingOrder: 1 },
    {
      email: 'clinique@mana.test',
      name: 'Clinique',
      role: 'SIGNER',
      signingOrder: 2,
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

const field = (recipientId: string) => ({
  recipientId,
  type: 'SIGNATURE' as const,
  page: 1,
  x: 10,
  y: 70,
  width: 30,
  height: 6,
})

/** A fake with one distributed document; returns its ids. */
async function sent(fake = fakeDocumenso()) {
  const client = documensoClient(BASE, KEY, fake.fetch)
  const { documentId, envelopeId, recipients } = await client.createDocument(
    PDF,
    input,
  )
  await client.addFields(documentId, recipients.map((r) => field(r.id)))
  await client.distribute(documentId)
  return {
    fake,
    client,
    documentId,
    envelopeId,
    ids: recipients.map((r) => r.id),
  }
}

Deno.test('fake-documenso: the client round trip (create, fields, distribute, sign, complete, download)', async () => {
  const { fake, client, documentId, envelopeId, ids } = await sent()
  assertEquals(documentId, '1')
  assertEquals(envelopeId, 'envelope_1')
  assertEquals(ids, ['101', '102'])
  assertEquals((await client.get(documentId)).status, 'PENDING')

  fake.open(documentId)
  fake.sign(documentId)
  const afterSign = await client.get(documentId)
  assertEquals(afterSign.status, 'PENDING')
  assertEquals(afterSign.recipients.map((r) => r.signingStatus), [
    'SIGNED',
    'NOT_SIGNED',
  ])

  fake.complete(documentId)
  const done = await client.get(documentId)
  assertEquals(done.status, 'COMPLETED')
  assert(done.completedAt)

  const signed = await client.downloadSigned(documentId)
  assertEquals(signed.subarray(0, PDF.length), PDF)
  assert(signed.length > PDF.length)
  assertEquals(fake.documents.get(documentId)?.meta.dateFormat, 'dd/MM/yyyy')
})

Deno.test('fake-documenso: a wrong key → 401 (ping), a signer without a SIGNATURE field cannot be distributed', async () => {
  const fake = fakeDocumenso()
  assertEquals(await documensoClient(BASE, 'wrong', fake.fetch).ping(), {
    ok: false,
    status: 401,
  })
  const client = documensoClient(BASE, KEY, fake.fetch)
  assertEquals(await client.ping(), { ok: true })
  const { documentId, recipients } = await client.createDocument(PDF, input)
  await client.addFields(documentId, [field(recipients[0].id)])
  const error = await assertRejects(
    () => client.distribute(documentId),
    DocumensoError,
  )
  assertEquals(error.status, 400)
})

Deno.test('fake-documenso: delete — pending → CANCELLED, then a NOT_FOUND 404 (resolved by the client); completed → 400', async () => {
  const { fake, client, documentId } = await sent()
  await client.cancel(documentId)
  assertEquals((await client.get(documentId)).status, 'CANCELLED')
  await client.cancel(documentId)
  const gone = await fake.fetch(`${BASE}/api/v2/document/delete`, {
    method: 'POST',
    headers: { Authorization: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: 1 }),
  })
  assertEquals([gone.status, (await gone.json()).code], [404, 'NOT_FOUND'])

  const second = await sent(fake)
  fake.complete(second.documentId)
  const error = await assertRejects(
    () => client.cancel(second.documentId),
    DocumensoError,
  )
  assertEquals(error.status, 400)

  // A draft is deleted outright.
  const draft = await client.createDocument(PDF, input)
  await client.cancel(draft.documentId)
  assert(!fake.documents.has(draft.documentId))
})

Deno.test('fake-documenso: envelope cancel — pending → CANCELLED and kept, reported once to onEvent; a draft → 400', async () => {
  const events: string[] = []
  const fake = fakeDocumenso({
    onEvent: (event, id) => events.push(`${event}:${id}`),
  })
  const { client, documentId, envelopeId } = await sent(fake)
  await client.cancel(documentId, { envelopeId, reason: 'Remplacé' })
  assertEquals((await client.get(documentId)).status, 'CANCELLED')
  // Again: Documenso refuses (400), the client reads CANCELLED back.
  await client.cancel(documentId, { envelopeId })
  await Promise.resolve()
  assertEquals(events, ['DOCUMENT_CANCELLED:1'])

  const draft = await client.createDocument(PDF, input)
  const error = await assertRejects(
    () => client.cancel(draft.documentId, { envelopeId: draft.envelopeId }),
    DocumensoError,
  )
  assertEquals(error.status, 400)
  assertEquals(fake.documents.get(draft.documentId)?.status, 'DRAFT')
})

Deno.test('fake-documenso: the expiry reaches the stored meta', async () => {
  const fake = fakeDocumenso()
  const client = documensoClient(BASE, KEY, fake.fetch)
  const { documentId } = await client.createDocument(PDF, {
    ...input,
    meta: { ...input.meta, expiryDays: 30 },
  })
  assertEquals(
    fake.documents.get(documentId)?.meta.envelopeExpirationPeriod,
    { unit: 'day', amount: 30 },
  )
})

Deno.test('fake-documenso: reject stores the reason; redistribute needs a pending document', async () => {
  const { fake, client, documentId, ids } = await sent()
  await client.redistribute(documentId, [ids[0]])
  fake.reject(documentId, undefined, 'Non merci')
  const doc = await client.get(documentId)
  assertEquals(doc.status, 'REJECTED')
  assertEquals(doc.recipients[0].rejectionReason, 'Non merci')
  await assertRejects(
    () => client.redistribute(documentId, [ids[1]]),
    DocumensoError,
  )
  assertThrows(() => fake.complete(documentId))
})

Deno.test('fake-documenso: failures inject a status per operation until removed', async () => {
  const fake = fakeDocumenso()
  const client = documensoClient(BASE, KEY, fake.fetch)
  const { documentId, recipients } = await client.createDocument(PDF, input)
  await client.addFields(documentId, recipients.map((r) => field(r.id)))
  fake.failures.distribute = 500
  const error = await assertRejects(
    () => client.distribute(documentId),
    DocumensoError,
  )
  assertEquals([error.code, error.status], ['provider_error', 500])
  assertEquals((await client.get(documentId)).status, 'DRAFT')
  delete fake.failures.distribute
  await client.distribute(documentId)
  assertEquals((await client.get(documentId)).status, 'PENDING')
})

Deno.test('fake-documenso: the webhook request carries the secret, the event, the external id and a ticking version', async () => {
  const { fake, documentId } = await sent()
  fake.open(documentId)
  const first = fake.webhookRequest(WEBHOOK, 'DOCUMENT_OPENED', documentId)
  const second = fake.webhookRequest(WEBHOOK, 'DOCUMENT_OPENED', documentId)
  assertEquals(first.url, WEBHOOK)
  assertEquals(
    first.headers.get('x-documenso-secret'),
    'local-dev-documenso-webhook-secret',
  )
  const a = await first.json()
  const b = await second.json()
  assertEquals(a.event, 'DOCUMENT_OPENED')
  assertEquals(a.payload.id, 1)
  assertEquals(a.payload.externalId, 'req-1')
  assertEquals(a.payload.recipients[0].readStatus, 'OPENED')
  assert(a.createdAt !== b.createdAt)
})

Deno.test('fake-documenso: in-flight requests are counted; other origins go to the fallback', async () => {
  const other = fakeFetch({
    'GET http://storage.test/x': () => new Response('ok'),
  })
  const fake = fakeDocumenso({ latencyMs: 5, fallback: other.fetch })
  const client = documensoClient(BASE, KEY, fake.fetch)
  await Promise.all([client.ping(), client.ping(), client.ping()])
  assertEquals(fake.inFlight, { current: 0, max: 3 })
  assertEquals(await (await fake.fetch('http://storage.test/x')).text(), 'ok')
  assertEquals(fake.calls.length, 3)
})
