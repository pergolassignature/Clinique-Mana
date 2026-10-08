import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from '@std/assert'
import {
  type CreateDocumentInput,
  documensoClient,
  DocumensoError,
  documensoEventId,
} from './documenso.ts'
import { FunctionError } from './errors.ts'
import {
  fakeFetch,
  type FetchCall,
  type Responder,
} from './testing/fake-fetch.ts'

const BASE = 'https://sign.cliniquemana.test'
const KEY = 'local-dev-documenso-key'
const ADDRESS = 'ana.gagnon@example.com'
const CLINIC = 'signataire@cliniquemana.test'
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n%%EOF\n')

const route = (method: string, path: string) => `${method} ${BASE}${path}`
const CREATE = route('POST', '/api/v2/document/create')
const GET_12 = route('GET', '/api/v2/document/12')
const FIELDS = route('POST', '/api/v2/document/field/create-many')
const DISTRIBUTE = route('POST', '/api/v2/document/distribute')
const REDISTRIBUTE = route('POST', '/api/v2/document/redistribute')
const DELETE = route('POST', '/api/v2/document/delete')
const DOWNLOAD_12 = route('GET', '/api/v2/document/12/download')
const LIST = route('GET', '/api/v2/document')

const json = (status: number, body: unknown): Responder => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const recipient = (over: Record<string, unknown> = {}) => ({
  id: 51,
  email: ADDRESS,
  name: 'Ana Gagnon',
  role: 'SIGNER',
  signingOrder: 1,
  readStatus: 'NOT_OPENED',
  signingStatus: 'NOT_SIGNED',
  sendStatus: 'NOT_SENT',
  signedAt: null,
  rejectionReason: null,
  ...over,
})

const documentBody = (over: Record<string, unknown> = {}) => ({
  id: 12,
  envelopeId: 'envelope_abc',
  externalId: 'req-1',
  title: 'Contrat',
  status: 'DRAFT',
  completedAt: null,
  recipients: [
    recipient(),
    recipient({ id: 52, email: CLINIC, name: 'Christine', signingOrder: 2 }),
  ],
  ...over,
})

const input = (
  over: Partial<CreateDocumentInput> = {},
): CreateDocumentInput => ({
  title: 'Contrat de services',
  externalId: '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e',
  recipients: [
    { email: ADDRESS, name: 'Ana Gagnon', role: 'SIGNER', signingOrder: 1 },
    { email: CLINIC, name: 'Christine', role: 'SIGNER', signingOrder: 2 },
  ],
  meta: {
    subject: 'Votre contrat',
    message: 'Bonjour,\n\nVoici votre contrat.',
    language: 'fr',
    distributionMethod: 'EMAIL',
    signingOrder: 'SEQUENTIAL',
    timezone: 'America/Toronto',
  },
  ...over,
})

const client = (fetchFn: typeof fetch, options = {}) =>
  documensoClient(BASE, KEY, fetchFn, options)

/** The multipart parts of a logged call. */
function formOf(call: FetchCall): Promise<FormData> {
  return new Response(call.body, {
    headers: { 'Content-Type': call.headers.get('content-type') ?? '' },
  }).formData()
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------
Deno.test('documensoClient: a missing key or a non-http(s) base URL → not_configured', () => {
  const { fetch } = fakeFetch({})
  for (
    const [base, key] of [[BASE, ''], ['', KEY], ['ftp://x.test', KEY], [
      'not a url',
      KEY,
    ]]
  ) {
    const error = assertThrows(() => documensoClient(base, key, fetch))
    assertInstanceOf(error, DocumensoError)
    assertEquals(error.code, 'not_configured')
    assertEquals(error.status, null)
  }
})

Deno.test('documensoClient: a trailing slash on the base URL is ignored', async () => {
  const { fetch, calls } = fakeFetch({ [LIST]: json(200, { data: [] }) })
  await documensoClient(`${BASE}//`, KEY, fetch).ping()
  assertEquals(calls[0].url, `${BASE}/api/v2/document?perPage=1`)
})

// ---------------------------------------------------------------------------
// createDocument
// ---------------------------------------------------------------------------
Deno.test('createDocument: multipart with the payload JSON and the PDF part, then reads the recipients', async () => {
  const { fetch, calls } = fakeFetch({
    [CREATE]: json(200, { id: 12, envelopeId: 'envelope_abc' }),
    [GET_12]: json(200, documentBody()),
  })
  const result = await client(fetch).createDocument(PDF, input())
  assertEquals(result, {
    documentId: '12',
    recipients: [{ id: '51', email: ADDRESS }, { id: '52', email: CLINIC }],
  })
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [CREATE, GET_12])

  const form = await formOf(calls[0])
  const payload = JSON.parse(String(form.get('payload')))
  assertEquals(payload, {
    title: 'Contrat de services',
    externalId: '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e',
    recipients: input().recipients,
    meta: {
      subject: 'Votre contrat',
      message: 'Bonjour,\n\nVoici votre contrat.',
      language: 'fr',
      distributionMethod: 'EMAIL',
      signingOrder: 'SEQUENTIAL',
      timezone: 'America/Toronto',
      dateFormat: 'dd/MM/yyyy',
    },
  })
  const file = form.get('file')
  assertInstanceOf(file, File)
  assertEquals(file.type, 'application/pdf')
  // No title or name in the file name (Loi 25): the title can name a person.
  assertEquals(file.name, 'document.pdf')
  assertEquals(new Uint8Array(await file.arrayBuffer()), PDF)
})

Deno.test('createDocument: the Authorization header is the bare key (no Bearer)', async () => {
  const { fetch, calls } = fakeFetch({
    [CREATE]: json(200, { id: 12 }),
    [GET_12]: json(200, documentBody()),
  })
  await client(fetch).createDocument(PDF, input())
  for (const call of calls) assertEquals(call.headers.get('authorization'), KEY)
})

Deno.test('createDocument: a 500 → DocumensoError provider_error, without the body text', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(500, {
      message: `Recipient ${ADDRESS} is invalid`,
      code: 'X',
    }),
  })
  const error = await assertRejects(
    () => client(fetch).createDocument(PDF, input()),
    DocumensoError,
  )
  assertInstanceOf(error, FunctionError)
  assertEquals(error.code, 'provider_error')
  assertEquals(error.status, 500)
  assertEquals(error.documentId, null)
  assertFalse(error.message.includes(ADDRESS))
  assertFalse(error.message.includes('invalid'))
})

Deno.test('createDocument: a failed recipient read keeps the created document id (so it can be cancelled)', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(200, { id: 12 }),
    [GET_12]: json(502, {}),
  })
  const error = await assertRejects(
    () => client(fetch).createDocument(PDF, input()),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
  assertEquals(error.status, 502)
  assertEquals(error.documentId, '12')
})

Deno.test('createDocument: a recipient missing from the created document → provider_error with the id', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(200, { id: 12 }),
    [GET_12]: json(200, documentBody({ recipients: [recipient()] })),
  })
  const error = await assertRejects(
    () => client(fetch).createDocument(PDF, input()),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
  assertEquals(error.documentId, '12')
  assertFalse(error.message.includes(CLINIC))
})

Deno.test('createDocument: recipients are matched by address without regard to case', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(200, { id: 12 }),
    [GET_12]: json(200, documentBody()),
  })
  const result = await client(fetch).createDocument(
    PDF,
    input({
      recipients: [
        {
          email: 'Ana.Gagnon@Example.com',
          name: 'Ana',
          role: 'SIGNER',
          signingOrder: 1,
        },
        { email: CLINIC, name: 'Christine', role: 'SIGNER', signingOrder: 2 },
      ],
    }),
  )
  assertEquals(result.recipients[0].id, '51')
})

Deno.test('createDocument: a malformed success body → provider_error', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(200, { envelopeId: 'envelope_abc' }),
  })
  const error = await assertRejects(
    () => client(fetch).createDocument(PDF, input()),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
  assertEquals(error.status, 200)
})

// ---------------------------------------------------------------------------
// Status mapping, timeouts, abort
// ---------------------------------------------------------------------------
Deno.test('errors: 401 and 403 → not_configured (the key is refused); 404, 400, 429 → provider_error', async () => {
  for (
    const [status, code] of [
      [401, 'not_configured'],
      [403, 'not_configured'],
      [404, 'provider_error'],
      [400, 'provider_error'],
      [429, 'provider_error'],
    ] as const
  ) {
    const { fetch } = fakeFetch({
      [DISTRIBUTE]: json(status, { message: 'no' }),
    })
    const error = await assertRejects(
      () => client(fetch).distribute('12'),
      DocumensoError,
    )
    assertEquals([error.code, error.status], [code, status])
  }
})

Deno.test('errors: a network failure → provider_error with no status', async () => {
  const { fetch } = fakeFetch({
    [DISTRIBUTE]: () => {
      throw new TypeError(`connect ECONNREFUSED ${BASE}`)
    },
  })
  const error = await assertRejects(
    () => client(fetch).distribute('12'),
    DocumensoError,
  )
  assertEquals([error.code, error.status], ['provider_error', null])
  assertFalse(error.message.includes(BASE))
})

Deno.test('errors: each request is cut after timeoutMs', async () => {
  const hang =
    ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
        )
      })) as typeof fetch
  const error = await assertRejects(
    () => client(hang, { timeoutMs: 10 }).distribute('12'),
    DocumensoError,
  )
  assertEquals([error.code, error.status], ['provider_error', null])
  assert(error.message.includes('timed out'))
})

Deno.test('errors: an aborted caller signal stops the request', async () => {
  const controller = new AbortController()
  controller.abort()
  const spy =
    ((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.reject(init?.signal?.reason)) as typeof fetch
  const error = await assertRejects(
    () => client(spy, { signal: controller.signal }).distribute('12'),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
  assert(error.message.includes('aborted'))
})

Deno.test('errors: a non-numeric document id is refused before any request', async () => {
  const { fetch, calls } = fakeFetch({})
  for (const id of ['', '12/../delete', 'envelope_abc', '1e3']) {
    const error = await assertRejects(
      () => client(fetch).get(id),
      DocumensoError,
    )
    assertEquals(error.code, 'provider_error')
  }
  assertEquals(calls.length, 0)
})

// ---------------------------------------------------------------------------
// addFields, distribute, redistribute
// ---------------------------------------------------------------------------
Deno.test('addFields: percent coordinates become pageNumber / pageX / pageY, ids become numbers', async () => {
  const { fetch, calls } = fakeFetch({ [FIELDS]: json(200, { fields: [] }) })
  await client(fetch).addFields('12', [
    {
      role: 'professional',
      type: 'SIGNATURE',
      page: 3,
      x: 10,
      y: 70.5,
      width: 30,
      height: 6,
      recipientId: '51',
    },
    {
      role: 'professional',
      type: 'INITIALS',
      page: 1,
      x: 85,
      y: 2,
      width: 8,
      height: 4,
      recipientId: '51',
    },
  ])
  assertEquals(JSON.parse(calls[0].body), {
    documentId: 12,
    fields: [
      {
        recipientId: 51,
        type: 'SIGNATURE',
        pageNumber: 3,
        pageX: 10,
        pageY: 70.5,
        width: 30,
        height: 6,
      },
      {
        recipientId: 51,
        type: 'INITIALS',
        pageNumber: 1,
        pageX: 85,
        pageY: 2,
        width: 8,
        height: 4,
      },
    ],
  })
  assertEquals(calls[0].headers.get('content-type'), 'application/json')
})

Deno.test('addFields and redistribute: an empty list makes no request', async () => {
  const { fetch, calls } = fakeFetch({})
  await client(fetch).addFields('12', [])
  await client(fetch).redistribute('12', [])
  assertEquals(calls.length, 0)
})

Deno.test('distribute and redistribute: the document id and recipient ids as numbers', async () => {
  const { fetch, calls } = fakeFetch({
    [DISTRIBUTE]: json(200, documentBody({ status: 'PENDING' })),
    [REDISTRIBUTE]: json(200, { success: true }),
  })
  await client(fetch).distribute('12')
  await client(fetch).redistribute('12', ['51', '52'])
  assertEquals(JSON.parse(calls[0].body), { documentId: 12 })
  assertEquals(JSON.parse(calls[1].body), {
    documentId: 12,
    recipients: [51, 52],
  })
})

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------
Deno.test('get: the status and each recipient, without addresses', async () => {
  const { fetch } = fakeFetch({
    [GET_12]: json(
      200,
      documentBody({
        status: 'REJECTED',
        recipients: [
          recipient({
            readStatus: 'OPENED',
            signingStatus: 'REJECTED',
            rejectionReason: 'Non',
          }),
          recipient({
            id: 52,
            email: CLINIC,
            signingStatus: 'SIGNED',
            signedAt: '2026-10-08T14:00:00.000Z',
          }),
        ],
      }),
    ),
  })
  const doc = await client(fetch).get('12')
  assertEquals(doc, {
    status: 'REJECTED',
    completedAt: null,
    recipients: [
      {
        id: '51',
        signingStatus: 'REJECTED',
        readStatus: 'OPENED',
        signedAt: null,
        rejectionReason: 'Non',
      },
      {
        id: '52',
        signingStatus: 'SIGNED',
        readStatus: 'NOT_OPENED',
        signedAt: '2026-10-08T14:00:00.000Z',
        rejectionReason: null,
      },
    ],
  })
  assertFalse(JSON.stringify(doc).includes('@'))
})

Deno.test('get: an unknown document status → provider_error', async () => {
  const { fetch } = fakeFetch({
    [GET_12]: json(200, documentBody({ status: 'ARCHIVED' })),
  })
  const error = await assertRejects(
    () => client(fetch).get('12'),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
})

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------
Deno.test('cancel: deletes the document; a 404 (already gone) resolves', async () => {
  const { fetch, calls } = fakeFetch({
    [DELETE]: [
      json(200, { success: true }),
      json(404, { message: 'Not found' }),
    ],
  })
  await client(fetch).cancel('12')
  await client(fetch).cancel('12')
  assertEquals(JSON.parse(calls[0].body), { documentId: 12 })
})

Deno.test('cancel: a 400 (e.g. a completed document) is still an error', async () => {
  const { fetch } = fakeFetch({ [DELETE]: json(400, { message: 'completed' }) })
  const error = await assertRejects(
    () => client(fetch).cancel('12'),
    DocumensoError,
  )
  assertEquals([error.code, error.status], ['provider_error', 400])
})

// ---------------------------------------------------------------------------
// downloadSigned
// ---------------------------------------------------------------------------
Deno.test('downloadSigned: the signed version, as bytes', async () => {
  const { fetch, calls } = fakeFetch({
    [DOWNLOAD_12]: () =>
      new Response(PDF, { headers: { 'Content-Type': 'application/pdf' } }),
  })
  assertEquals(await client(fetch).downloadSigned('12'), PDF)
  assertEquals(
    calls[0].url,
    `${BASE}/api/v2/document/12/download?version=signed`,
  )
})

Deno.test('downloadSigned: a body that is not a PDF → provider_error', async () => {
  const { fetch } = fakeFetch({
    [DOWNLOAD_12]: json(200, { downloadUrl: 'https://s3.test/x' }),
  })
  const error = await assertRejects(
    () => client(fetch).downloadSigned('12'),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
})

Deno.test('downloadSigned: over maxDownloadBytes → provider_error (declared or streamed)', async () => {
  const big = new Uint8Array(64).fill(0x20)
  big.set(PDF)
  const { fetch } = fakeFetch({
    [DOWNLOAD_12]: [
      () => new Response(big, { headers: { 'Content-Length': '64' } }),
      // No Content-Length: the stream is counted.
      () =>
        new Response(
          ReadableStream.from([big.subarray(0, 40), big.subarray(40)]),
        ),
    ],
  })
  const c = client(fetch, { maxDownloadBytes: 32 })
  for (let i = 0; i < 2; i++) {
    const error = await assertRejects(
      () => c.downloadSigned('12'),
      DocumensoError,
    )
    assertEquals(error.code, 'provider_error')
  }
})

// ---------------------------------------------------------------------------
// ping
// ---------------------------------------------------------------------------
Deno.test('ping: 200 → ok; 401 → { ok: false, status: 401 }', async () => {
  const { fetch } = fakeFetch({
    [LIST]: [json(200, { data: [] }), json(401, { message: 'Unauthorized' })],
  })
  const c = client(fetch)
  assertEquals(await c.ping(), { ok: true })
  assertEquals(await c.ping(), { ok: false, status: 401 })
})

Deno.test('ping: no answer at all → provider_error', async () => {
  const { fetch } = fakeFetch({
    [LIST]: () => {
      throw new TypeError('dns error')
    },
  })
  const error = await assertRejects(() => client(fetch).ping(), DocumensoError)
  assertEquals([error.code, error.status], ['provider_error', null])
})

// ---------------------------------------------------------------------------
// documensoEventId
// ---------------------------------------------------------------------------
Deno.test('documensoEventId: terminal events ignore the version', () => {
  assertEquals(
    documensoEventId('DOCUMENT_COMPLETED', '12', 'x'),
    'DOCUMENT_COMPLETED:12',
  )
  assertEquals(
    documensoEventId('DOCUMENT_REJECTED', '12', '2026-10-08T14:00:00Z'),
    'DOCUMENT_REJECTED:12',
  )
  assertEquals(
    documensoEventId('DOCUMENT_CANCELLED', '12', null),
    'DOCUMENT_CANCELLED:12',
  )
})

Deno.test('documensoEventId: other events include the version (or « unversioned »)', () => {
  assertEquals(
    documensoEventId('DOCUMENT_OPENED', '12', '2026-10-08T14:00:00.000Z'),
    'DOCUMENT_OPENED:12:2026-10-08T14:00:00.000Z',
  )
  assertEquals(
    documensoEventId('DOCUMENT_SIGNED', '12', null),
    'DOCUMENT_SIGNED:12:unversioned',
  )
})
