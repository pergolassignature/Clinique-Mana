import { assert, assertEquals } from '@std/assert'
import { documensoClient } from '../documenso.ts'
import { fakeDocumensoServer } from './fake-documenso-server.ts'
import { fakeFetch } from './fake-fetch.ts'

const KEY = 'local-dev-documenso-key'
const HOOK = 'http://127.0.0.1:55321/functions/v1/signing-webhook?org=o'
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n%%EOF\n')
/** What a browser or curl on the host calls (the fake's own URL is host.docker.internal). */
const LOCAL = 'http://127.0.0.1:55390'

/** A server whose webhooks land in `hooks`; its handler as a client fetch. */
function setup(hookStatus = 200) {
  const hooks = fakeFetch({
    [`POST ${HOOK.split('?')[0]}`]: () =>
      new Response(null, { status: hookStatus }),
  })
  const server = fakeDocumensoServer({ webhookUrl: HOOK, fetch: hooks.fetch })
  const viaHttp =
    ((input: RequestInfo | URL, init?: RequestInit) =>
      server.handler(new Request(input, init))) as typeof fetch
  const client = documensoClient(LOCAL, KEY, viaHttp)
  return { server, hooks, client, viaHttp }
}

async function distributed(client: ReturnType<typeof setup>['client']) {
  const created = await client.createDocument(PDF, {
    title: 'Contrat',
    externalId: 'req-1',
    recipients: [
      { email: 'pro@mana.test', name: 'Pro', role: 'SIGNER', signingOrder: 1 },
    ],
    meta: {
      subject: 'Sujet',
      message: 'Message',
      language: 'fr',
      distributionMethod: 'EMAIL',
      signingOrder: 'SEQUENTIAL',
      timezone: 'America/Toronto',
    },
  })
  await client.addFields(created.documentId, [{
    recipientId: created.recipients[0].id,
    type: 'SIGNATURE',
    page: 1,
    x: 10,
    y: 70,
    width: 30,
    height: 6,
  }])
  await client.distribute(created.documentId)
  return created
}

Deno.test('fake-documenso-server: the API answers on any host (the client round trip)', async () => {
  const { client, server } = setup()
  const { documentId, envelopeId } = await distributed(client)
  assertEquals([documentId, envelopeId], ['1', 'envelope_1'])
  assertEquals((await client.get(documentId)).status, 'PENDING')
  assertEquals(await client.ping(), { ok: true })
  // Re-addressed to the fake's own origin.
  assert(server.fake.calls.every((c) => c.url.startsWith(server.fake.baseUrl)))
})

Deno.test('fake-documenso-server: an admin action posts the signed webhook and answers its outcome', async () => {
  const { client, hooks, viaHttp } = setup(202)
  const { documentId } = await distributed(client)
  const res = await viaHttp(`${LOCAL}/__fake/complete/${documentId}`, {
    method: 'POST',
  })
  assertEquals(await res.json(), {
    event: 'DOCUMENT_COMPLETED',
    documentId: '1',
    webhookStatus: 202,
  })
  assertEquals(hooks.calls.length, 1)
  assertEquals(hooks.calls[0].url, HOOK)
  assertEquals(
    hooks.calls[0].headers.get('x-documenso-secret'),
    'local-dev-documenso-webhook-secret',
  )
  const hook = JSON.parse(hooks.calls[0].body)
  assertEquals([hook.event, hook.payload.status], [
    'DOCUMENT_COMPLETED',
    'COMPLETED',
  ])
  assertEquals((await client.get(documentId)).status, 'COMPLETED')

  // No longer pending: 400; unknown document or route: 404.
  const again = await viaHttp(`${LOCAL}/__fake/sign/${documentId}`, {
    method: 'POST',
  })
  assertEquals(again.status, 400)
  assertEquals(
    (await viaHttp(`${LOCAL}/__fake/open/99`, { method: 'POST' })).status,
    404,
  )
  assertEquals((await viaHttp(`${LOCAL}/__fake/nope`)).status, 404)
})

Deno.test('fake-documenso-server: a cancelled pending document posts DOCUMENT_CANCELLED after the answer', async () => {
  const { client, hooks, server } = setup()
  const { documentId, envelopeId } = await distributed(client)
  await client.cancel(documentId, { envelopeId })
  await server.idle()
  assertEquals(hooks.calls.map((c) => JSON.parse(c.body).event), [
    'DOCUMENT_CANCELLED',
  ])
})

Deno.test('fake-documenso-server: the document list has no address; an unreachable webhook is reported by name', async () => {
  const server = fakeDocumensoServer({
    webhookUrl: HOOK,
    fetch: () => Promise.reject(new TypeError('connection refused')),
  })
  const viaHttp =
    ((input: RequestInfo | URL, init?: RequestInit) =>
      server.handler(new Request(input, init))) as typeof fetch
  const client = documensoClient(LOCAL, KEY, viaHttp)
  const { documentId } = await distributed(client)
  const list = await (await viaHttp(`${LOCAL}/__fake/documents`)).json()
  assertEquals(list[0].status, 'PENDING')
  assert(!JSON.stringify(list).includes('@'))
  const res = await viaHttp(`${LOCAL}/__fake/open/${documentId}`, {
    method: 'POST',
  })
  assertEquals(await res.json(), {
    event: 'DOCUMENT_OPENED',
    documentId: '1',
    webhookError: 'TypeError',
  })
})
