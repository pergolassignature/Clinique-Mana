import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from '@std/assert'
import {
  type CreateEnvelopeInput,
  documensoClient,
  DocumensoError,
  documensoEventId,
  ENVELOPE_ID,
  isEnvelopeId,
  isPublicAddress,
} from './documenso.ts'
import { FunctionError } from './errors.ts'
import {
  fakeFetch,
  type FetchCall,
  type Responder,
} from './testing/fake-fetch.ts'
import { deployedReach, LOCAL_REACH } from './testing/signing-fixtures.ts'

const BASE = 'https://sign.cliniquemana.test'
const KEY = 'local-dev-documenso-key'
const ADDRESS = 'ana.gagnon@example.com'
const CLINIC = 'signataire@cliniquemana.test'
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n%%EOF\n')

/** An envelope id as Documenso 2.20 makes them (seen live on the clinic's instance). */
const E = 'envelope_hsnzzscbexaddcar'
const ITEM = 'envelope_item_hsnzzscbexaddcar'

const route = (method: string, path: string) => `${method} ${BASE}${path}`
const CREATE = route('POST', '/api/v2/envelope/create')
const GET_E = route('GET', `/api/v2/envelope/${E}`)
const DISTRIBUTE = route('POST', '/api/v2/envelope/distribute')
const REDISTRIBUTE = route('POST', '/api/v2/envelope/redistribute')
const DELETE = route('POST', '/api/v2/envelope/delete')
const CANCEL = route('POST', '/api/v2/envelope/cancel')
const DOWNLOAD = route('GET', `/api/v2/envelope/item/${ITEM}/download`)
const LIST = route('GET', '/api/v2/envelope')

const json = (status: number, body: unknown): Responder => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const recipient = (over: Record<string, unknown> = {}) => ({
  id: 51,
  envelopeId: E,
  email: ADDRESS,
  name: 'Ana Gagnon',
  token: 'secret-signing-token-51',
  role: 'SIGNER',
  signingOrder: 1,
  readStatus: 'NOT_OPENED',
  signingStatus: 'NOT_SIGNED',
  sendStatus: 'NOT_SENT',
  expired: null,
  expiresAt: null,
  signedAt: null,
  rejectionReason: null,
  ...over,
})

/** `GET /api/v2/envelope/{id}`, in the parts the client reads (plus a few it must ignore). */
const envelopeBody = (over: Record<string, unknown> = {}) => ({
  id: E,
  secondaryId: 'document_12',
  type: 'DOCUMENT',
  externalId: 'req-1',
  title: 'Contrat',
  status: 'DRAFT',
  completedAt: null,
  recipients: [
    recipient(),
    recipient({
      id: 52,
      email: CLINIC,
      name: 'Christine',
      signingOrder: 2,
      token: 'secret-signing-token-52',
    }),
  ],
  envelopeItems: [{
    id: ITEM,
    envelopeId: E,
    documentDataId: 'data_1',
    title: 'document.pdf',
    order: 0,
  }],
  ...over,
})

const SIGNATURE = {
  role: 'professional',
  type: 'SIGNATURE' as const,
  page: 3,
  x: 10,
  y: 70.5,
  width: 30,
  height: 6,
}

const input = (
  over: Partial<CreateEnvelopeInput> = {},
): CreateEnvelopeInput => ({
  title: 'Contrat de services',
  externalId: '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e',
  recipients: [
    {
      email: ADDRESS,
      name: 'Ana Gagnon',
      role: 'SIGNER',
      signingOrder: 1,
      fields: [SIGNATURE, {
        role: 'professional',
        type: 'INITIALS',
        page: 1,
        x: 85,
        y: 2,
        width: 8,
        height: 4,
      }],
    },
    {
      email: CLINIC,
      name: 'Christine',
      role: 'SIGNER',
      signingOrder: 2,
      fields: [{ ...SIGNATURE, role: 'clinic', x: 55 }],
    },
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

/** A deployed client whose host resolves to a public address. */
const client = (fetchFn: typeof fetch, options = {}) =>
  documensoClient(BASE, KEY, fetchFn, { reach: deployedReach(), ...options })

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
  await documensoClient(`${BASE}//`, KEY, fetch, { reach: deployedReach() })
    .ping()
  assertEquals(calls[0].url, `${BASE}/api/v2/envelope?perPage=1`)
})

// ---------------------------------------------------------------------------
// Reach (P3-34: SSRF and key exfiltration)
// ---------------------------------------------------------------------------
/** The `redirect` mode of every request `fetchFn` receives. */
function tracingRedirects(fetchFn: typeof fetch) {
  const modes: RequestRedirect[] = []
  const traced = ((input: RequestInfo | URL, init?: RequestInit) => {
    modes.push(new Request(input, init).redirect)
    return fetchFn(input, init)
  }) as typeof fetch
  return { traced, modes }
}

Deno.test('reach: every request is sent with redirect: manual', async () => {
  const { fetch } = fakeFetch({
    [LIST]: json(200, { data: [] }),
    [CREATE]: json(200, { id: E }),
    [GET_E]: json(200, envelopeBody()),
    [DISTRIBUTE]: json(200, {}),
  })
  const { traced, modes } = tracingRedirects(fetch)
  const documenso = client(traced)
  await documenso.ping()
  await documenso.createEnvelope(PDF, input())
  await documenso.distribute(E)
  assertEquals(modes, ['manual', 'manual', 'manual', 'manual'])
})

Deno.test('reach: any 3xx is a provider_error, never followed (the key stays home)', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const { fetch, calls } = fakeFetch({
      [LIST]: () => Response.redirect('https://evil.test/collect', status),
    })
    const error = await assertRejects(
      () => client(fetch).ping(),
      DocumensoError,
    )
    assertEquals([error.code, error.status], ['provider_error', status])
    assertFalse(error.message.includes('evil.test'))
    assertEquals(calls.map((c) => c.url), [`${BASE}/api/v2/envelope?perPage=1`])
  }
  const { fetch, calls } = fakeFetch({
    [GET_E]: () => Response.redirect('http://169.254.169.254/', 302),
  })
  await assertRejects(() => client(fetch).get(E), DocumensoError)
  assertEquals(calls.length, 1)
})

Deno.test('reach: a name resolving to a private address is refused before any request, the address never quoted', async () => {
  const privates = [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.254',
    '0.0.0.0',
    '224.0.0.1',
    '239.255.255.250',
    '255.255.255.255',
    '240.0.0.1',
    '::',
    '::1',
    'fd00::1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '2002:a00:1::1',
    '2001:db8::1',
  ]
  for (const address of privates) {
    const v6 = address.includes(':')
    const reach = deployedReach(v6 ? { AAAA: [address] } : { A: [address] })
    const { fetch, calls } = fakeFetch({ [LIST]: json(200, { data: [] }) })
    const error = await assertRejects(
      () => client(fetch, { reach }).ping(),
      DocumensoError,
      undefined,
      address,
    )
    assertEquals([error.code, error.status], ['provider_error', null], address)
    assertFalse(error.message.includes(address), address)
    assertFalse(error.message.includes('sign.cliniquemana.test'), address)
    assertEquals(calls.length, 0, address)
    assertEquals(reach.lookups, [
      'A sign.cliniquemana.test',
      'AAAA sign.cliniquemana.test',
    ])
  }
})

Deno.test('reach: one private record among public ones refuses the request', async () => {
  const reach = deployedReach({
    A: ['93.184.215.14'],
    AAAA: ['2606:2800:220:1::1', '::1'],
  })
  const { fetch, calls } = fakeFetch({ [LIST]: json(200, { data: [] }) })
  await assertRejects(() => client(fetch, { reach }).ping(), DocumensoError)
  assertEquals(calls.length, 0)
})

Deno.test('reach: public records → the request goes; the name is resolved again before every request', async () => {
  const reach = deployedReach({
    A: ['93.184.215.14'],
    AAAA: ['2606:2800:220:1:248:1893:25c8:1946'],
  })
  const { fetch, calls } = fakeFetch({ [LIST]: json(200, { data: [] }) })
  const documenso = client(fetch, { reach })
  assertEquals(await documenso.ping(), { ok: true })
  assertEquals(await documenso.ping(), { ok: true })
  assertEquals(calls.length, 2)
  assertEquals(reach.lookups.length, 4)
})

Deno.test('reach: a name that does not resolve → provider_error (unreachable), no request', async () => {
  const reach = deployedReach({})
  const { fetch, calls } = fakeFetch({ [LIST]: json(200, { data: [] }) })
  const error = await assertRejects(
    () => client(fetch, { reach }).ping(),
    DocumensoError,
  )
  assertEquals([error.code, error.status], ['provider_error', null])
  assertEquals(error.message, 'Documenso ping unreachable')
  assertEquals(calls.length, 0)
})

Deno.test('reach: deployed, the local fake, http, private names and private IP literals are refused without a lookup', async () => {
  for (
    const base of [
      'http://host.docker.internal:55390',
      'https://host.docker.internal:55390',
      'http://sign.cliniquemana.test',
      'https://localhost:8443',
      'https://sign.localhost',
      'https://documenso.internal',
      'https://sign.local',
      'https://documenso',
      'https://127.0.0.1',
      'https://127.1',
      'https://0x7f000001',
      'https://[::1]',
      'https://[::ffff:10.0.0.1]',
    ]
  ) {
    const reach = deployedReach()
    const { fetch, calls } = fakeFetch({})
    const error = await assertRejects(
      () => documensoClient(base, KEY, fetch, { reach }).ping(),
      DocumensoError,
      undefined,
      base,
    )
    assertEquals(error.code, 'provider_error', base)
    assertEquals([calls.length, reach.lookups.length], [0, 0], base)
  }
})

Deno.test('reach: without options a client is deployed (fails closed): the local fake is refused', async () => {
  const { fetch, calls } = fakeFetch({})
  await assertRejects(
    () =>
      documensoClient('http://host.docker.internal:55390', KEY, fetch).ping(),
    DocumensoError,
  )
  assertEquals(calls.length, 0)
})

Deno.test('reach: local dev allows the fake at host.docker.internal, with no lookup', async () => {
  const base = 'http://host.docker.internal:55390'
  const { fetch, calls } = fakeFetch({
    [`GET ${base}/api/v2/envelope`]: json(200, { data: [] }),
  })
  assertEquals(
    await documensoClient(base, KEY, fetch, { reach: LOCAL_REACH }).ping(),
    { ok: true },
  )
  assertEquals(calls.length, 1)
})

Deno.test('isPublicAddress: public unicast only, IPv4-mapped IPv6 judged by its IPv4', () => {
  for (
    const address of [
      '93.184.215.14',
      '8.8.8.8',
      '172.32.0.1',
      '100.128.0.1',
      '2606:2800:220:1:248:1893:25c8:1946',
      '2a00:1450:4001:81c::200e',
      '::ffff:93.184.215.14',
      '::ffff:5db8:d70e',
      '[2606:2800:220:1::1]',
    ]
  ) assert(isPublicAddress(address), address)
  for (
    const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '192.0.0.8',
      '198.18.0.1',
      '::',
      '::1',
      '[::1]',
      'fd12:3456::1',
      'fe80::1%eth0',
      'ff02::1',
      '::ffff:192.168.0.1',
      '::ffff:c0a8:1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      '2001::1',
      '2001:db8::1',
      'not an address',
      '1.2.3',
      '256.1.1.1',
      '1:2:3:4:5:6:7:8:9',
      '1::2::3',
      '',
    ]
  ) assertFalse(isPublicAddress(address), address)
})

// ---------------------------------------------------------------------------
// createEnvelope
// ---------------------------------------------------------------------------
Deno.test('createEnvelope: multipart with type DOCUMENT, inline fields (identifier 0, positionX/positionY) and one `files` part, then reads the recipients', async () => {
  const { fetch, calls } = fakeFetch({
    [CREATE]: json(200, { id: E }),
    [GET_E]: json(200, envelopeBody()),
  })
  const result = await client(fetch).createEnvelope(PDF, input())
  assertEquals(result, {
    envelopeId: E,
    recipients: [{ id: '51', email: ADDRESS }, { id: '52', email: CLINIC }],
  })
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [CREATE, GET_E])

  const form = await formOf(calls[0])
  const payload = JSON.parse(String(form.get('payload')))
  assertEquals(payload, {
    title: 'Contrat de services',
    type: 'DOCUMENT',
    externalId: '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e',
    recipients: [
      {
        email: ADDRESS,
        name: 'Ana Gagnon',
        role: 'SIGNER',
        signingOrder: 1,
        fields: [
          {
            identifier: 0,
            type: 'SIGNATURE',
            page: 3,
            positionX: 10,
            positionY: 70.5,
            width: 30,
            height: 6,
          },
          {
            identifier: 0,
            type: 'INITIALS',
            page: 1,
            positionX: 85,
            positionY: 2,
            width: 8,
            height: 4,
          },
        ],
      },
      {
        email: CLINIC,
        name: 'Christine',
        role: 'SIGNER',
        signingOrder: 2,
        fields: [{
          identifier: 0,
          type: 'SIGNATURE',
          page: 3,
          positionX: 55,
          positionY: 70.5,
          width: 30,
          height: 6,
        }],
      },
    ],
    meta: {
      subject: 'Votre contrat',
      message: 'Bonjour,\n\nVoici votre contrat.',
      language: 'fr',
      distributionMethod: 'EMAIL',
      signingOrder: 'SEQUENTIAL',
      timezone: 'America/Toronto',
      dateFormat: 'dd/MM/yyyy',
      emailSettings: { ownerRecipientExpired: false },
    },
  })
  assertEquals(form.getAll('files').length, 1)
  assertEquals(form.get('file'), null)
  const file = form.get('files')
  assertInstanceOf(file, File)
  assertEquals(file.type, 'application/pdf')
  // No title or name in the file name (Loi 25): the title can name a person.
  assertEquals(file.name, 'document.pdf')
  assertEquals(new Uint8Array(await file.arrayBuffer()), PDF)
})

Deno.test('createEnvelope: expiryDays becomes envelopeExpirationPeriod in days', async () => {
  const { fetch, calls } = fakeFetch({
    [CREATE]: json(200, { id: E }),
    [GET_E]: json(200, envelopeBody()),
  })
  const base = input()
  await client(fetch).createEnvelope(
    PDF,
    { ...base, meta: { ...base.meta, expiryDays: 14 } },
  )
  const { meta } = JSON.parse(String((await formOf(calls[0])).get('payload')))
  assertEquals(meta.envelopeExpirationPeriod, { unit: 'day', amount: 14 })
  assertFalse('expiryDays' in meta)
})

Deno.test('createEnvelope: two recipients with one address, a bad expiry, a subject or message too long → invalid_request, no request', async () => {
  const { fetch, calls } = fakeFetch({})
  const base = input()
  for (
    const bad of [
      input({
        recipients: [
          base.recipients[0],
          { ...base.recipients[1], email: ' Ana.Gagnon@EXAMPLE.com' },
        ],
      }),
      ...[0, 1.5, -3, Number.NaN].map((expiryDays) => ({
        ...base,
        meta: { ...base.meta, expiryDays },
      })),
      { ...base, meta: { ...base.meta, subject: 'x'.repeat(255) } },
      { ...base, meta: { ...base.meta, message: 'x'.repeat(5001) } },
    ]
  ) {
    const error = await assertRejects(
      () => client(fetch).createEnvelope(PDF, bad),
      DocumensoError,
    )
    assertEquals([error.code, error.status], ['invalid_request', null])
    assertFalse(error.message.includes('@'))
  }
  assertEquals(calls.length, 0)
  // At the limits exactly: accepted.
  const ok = fakeFetch({
    [CREATE]: json(200, { id: E }),
    [GET_E]: json(200, envelopeBody()),
  })
  await client(ok.fetch).createEnvelope(PDF, {
    ...base,
    meta: { ...base.meta, subject: 'x'.repeat(254), message: 'x'.repeat(5000) },
  })
})

Deno.test('createEnvelope: an answer without a well-formed envelope id → provider_error, no read, no id to cancel', async () => {
  for (
    const created of [{ id: 12 }, { id: '12' }, { id: '../x' }, {
      envelopeId: E,
    }, { id: 'envelope_a/b' }]
  ) {
    const { fetch, calls } = fakeFetch({ [CREATE]: json(200, created) })
    const error = await assertRejects(
      () => client(fetch).createEnvelope(PDF, input()),
      DocumensoError,
    )
    assertEquals([error.code, error.status], ['provider_error', 200])
    assertEquals(error.message, 'Documenso create: unexpected response')
    assertEquals(error.envelopeId, null)
    assertEquals(calls.length, 1)
  }
})

Deno.test('createEnvelope: the Authorization header is the bare key (no Bearer)', async () => {
  const { fetch, calls } = fakeFetch({
    [CREATE]: json(200, { id: E }),
    [GET_E]: json(200, envelopeBody()),
  })
  await client(fetch).createEnvelope(PDF, input())
  for (const call of calls) assertEquals(call.headers.get('authorization'), KEY)
})

Deno.test('createEnvelope: a 500 → DocumensoError provider_error, without the body text', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(500, {
      message: `Recipient ${ADDRESS} is invalid`,
      code: 'X',
    }),
  })
  const error = await assertRejects(
    () => client(fetch).createEnvelope(PDF, input()),
    DocumensoError,
  )
  assertInstanceOf(error, FunctionError)
  assertEquals(error.code, 'provider_error')
  assertEquals(error.status, 500)
  assertEquals(error.envelopeId, null)
  assertFalse(error.message.includes(ADDRESS))
  assertFalse(error.message.includes('invalid'))
})

Deno.test('createEnvelope: a failed recipient read keeps the created envelope id (so it can be cancelled)', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(200, { id: E }),
    [GET_E]: json(502, {}),
  })
  const error = await assertRejects(
    () => client(fetch).createEnvelope(PDF, input()),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
  assertEquals(error.status, 502)
  assertEquals(error.envelopeId, E)
})

Deno.test('createEnvelope: a recipient missing from the created envelope → provider_error with the id', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(200, { id: E }),
    [GET_E]: json(200, envelopeBody({ recipients: [recipient()] })),
  })
  const error = await assertRejects(
    () => client(fetch).createEnvelope(PDF, input()),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
  assertEquals(error.envelopeId, E)
  assertFalse(error.message.includes(CLINIC))
})

Deno.test('createEnvelope: recipients are matched by address without regard to case', async () => {
  const { fetch } = fakeFetch({
    [CREATE]: json(200, { id: E }),
    [GET_E]: json(200, envelopeBody()),
  })
  const base = input()
  const result = await client(fetch).createEnvelope(
    PDF,
    input({
      recipients: [
        { ...base.recipients[0], email: 'Ana.Gagnon@Example.com' },
        base.recipients[1],
      ],
    }),
  )
  assertEquals(result.recipients[0].id, '51')
})

Deno.test('createEnvelope: a malformed success body → provider_error', async () => {
  const { fetch } = fakeFetch({ [CREATE]: json(200, { success: true }) })
  const error = await assertRejects(
    () => client(fetch).createEnvelope(PDF, input()),
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
      () => client(fetch).distribute(E),
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
    () => client(fetch).distribute(E),
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
    () => client(hang, { timeoutMs: 10 }).distribute(E),
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
    () => client(spy, { signal: controller.signal }).distribute(E),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
  assert(error.message.includes('aborted'))
})

/** A body that sends `head`, then fails as `fail` says (on the request's abort, or at once). */
const brokenBody =
  (head: string, fail: 'abort' | 'reset'): Responder => (req) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(head))
          if (fail === 'reset') {
            controller.error(new TypeError(`connection reset: ${BASE}/api/v2`))
          } else {
            req.signal.addEventListener(
              'abort',
              () => controller.error(req.signal.reason),
            )
          }
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )

Deno.test('errors: a body that fails mid-read → provider_error, never the raw error', async () => {
  for (
    const [name, call] of [
      ['get', (c: ReturnType<typeof client>) => c.get(E)],
      ['downloadSigned', (c: ReturnType<typeof client>) => c.downloadSigned(E)],
      ['ping', (c: ReturnType<typeof client>) => c.ping()],
    ] as const
  ) {
    const { fetch } = fakeFetch({
      [GET_E]: name === 'get'
        ? brokenBody('{"id":"envelope_', 'reset')
        : json(200, envelopeBody({ status: 'COMPLETED' })),
      [DOWNLOAD]: brokenBody('%PDF-1.7', 'reset'),
      [LIST]: brokenBody('{"data":[', 'reset'),
    })
    const error = await assertRejects(() => call(client(fetch)), DocumensoError)
    assertEquals([error.code, error.status], ['provider_error', null], name)
    assert(error.message.includes('unreachable while reading'), name)
    assertFalse(error.message.includes(BASE), name)
  }
})

Deno.test('errors: the timeout also covers the body (it stalls mid-read)', async () => {
  const stalled = fakeFetch({ [GET_E]: brokenBody('{"id":', 'abort') })
  const download = fakeFetch({
    [GET_E]: json(200, envelopeBody({ status: 'COMPLETED' })),
    [DOWNLOAD]: brokenBody('%PDF-1.7', 'abort'),
  })
  for (
    const call of [
      () => client(stalled.fetch, { timeoutMs: 20 }).get(E),
      () => client(download.fetch, { timeoutMs: 20 }).downloadSigned(E),
    ]
  ) {
    const error = await assertRejects(call, DocumensoError)
    assertEquals([error.code, error.status], ['provider_error', null])
    assert(error.message.includes('timed out while reading'), error.message)
  }
})

Deno.test('errors: a non-envelope id is refused before any request, by every method', async () => {
  const { fetch, calls } = fakeFetch({})
  const c = client(fetch)
  for (
    const id of [
      '',
      '12',
      'envelope_',
      'envelope_a/b',
      'envelope_../delete',
      `envelope_${'a'.repeat(65)}`,
      'abc',
    ]
  ) {
    for (
      const call of [
        () => c.get(id),
        () => c.distribute(id),
        () => c.redistribute(id, ['51']),
        () => c.cancel(id),
        () => c.cancel(id, { draft: true }),
        () => c.downloadSigned(id),
      ]
    ) {
      const error = await assertRejects(call, DocumensoError, undefined, id)
      assertEquals([error.code, error.status], ['provider_error', null], id)
      assert(error.message.endsWith('invalid id'), id)
    }
  }
  assertEquals(calls.length, 0)
})

Deno.test('errors: a non-numeric recipient id is refused; a 15-digit one is accepted (a safe integer)', async () => {
  const { fetch, calls } = fakeFetch({
    [REDISTRIBUTE]: json(200, { success: true }),
  })
  for (const id of ['', 'x', '1e3', '1234567890123456', '0']) {
    await assertRejects(
      () => client(fetch).redistribute(E, [id]),
      DocumensoError,
    )
  }
  assertEquals(calls.length, 0)
  await client(fetch).redistribute(E, ['123456789012345'])
  assertEquals(JSON.parse(calls[0].body).recipients, [123456789012345])
})

Deno.test('isEnvelopeId: ENVELOPE_ID, as the live ids look', () => {
  assert(isEnvelopeId(E))
  assert(isEnvelopeId('envelope_aaaaaaaaaaaaaaab'))
  for (const v of [null, 12, '12', 'envelope_', 'Envelope_x', 'envelope_a b']) {
    assertFalse(isEnvelopeId(v), String(v))
  }
})

Deno.test('ENVELOPE_ID equals the database check (signature_requests.envelope_id and the envelope RPCs)', async () => {
  const MIGRATIONS = new URL('../../migrations/', import.meta.url)
  const names: string[] = []
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (entry.isFile && entry.name.endsWith('.sql')) names.push(entry.name)
  }
  const envelope = names.find((n) => n.endsWith('_core_signing_envelope.sql'))
  assert(envelope, 'no *_core_signing_envelope.sql migration')
  const signing = names.find((n) => n.endsWith('_core_signing.sql'))
  assert(signing, 'no *_core_signing.sql migration')
  const patterns = new Set<string>()
  for (const name of [signing, envelope]) {
    const sql = await Deno.readTextFile(new URL(name, MIGRATIONS))
    for (const [, pattern] of sql.matchAll(/'(\^envelope_[^']*)'/g)) {
      patterns.add(pattern)
    }
  }
  assertEquals([...patterns], [ENVELOPE_ID.source])
})

// ---------------------------------------------------------------------------
// distribute, redistribute
// ---------------------------------------------------------------------------
Deno.test('distribute: { envelopeId }; its answer (tokens, signing URLs) is not read', async () => {
  const answer = {
    success: true,
    id: E,
    recipients: [{
      id: 51,
      email: ADDRESS,
      token: 'secret-signing-token-51',
      signingUrl: `${BASE}/sign/secret-signing-token-51`,
    }],
  }
  let bodyRead = false
  const { fetch, calls } = fakeFetch({
    [DISTRIBUTE]: () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            bodyRead = true
            controller.enqueue(new TextEncoder().encode(JSON.stringify(answer)))
            controller.close()
          },
        }, { highWaterMark: 0 }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  })
  const result = await client(fetch).distribute(E)
  assertEquals(result, undefined)
  assertEquals(JSON.parse(calls[0].body), { envelopeId: E })
  assertEquals(calls[0].headers.get('content-type'), 'application/json')
  assertFalse(bodyRead, 'the answer is discarded unread')
})

Deno.test('redistribute: the envelope id and the recipient ids as numbers; an empty list makes no request', async () => {
  const { fetch, calls } = fakeFetch({
    [REDISTRIBUTE]: json(200, { success: true, id: E, recipients: [] }),
  })
  await client(fetch).redistribute(E, [])
  assertEquals(calls.length, 0)
  await client(fetch).redistribute(E, ['51', '52'])
  assertEquals(JSON.parse(calls[0].body), {
    envelopeId: E,
    recipients: [51, 52],
  })
})

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------
Deno.test('get: the status and each recipient, without addresses or tokens', async () => {
  const { fetch } = fakeFetch({
    [GET_E]: json(
      200,
      envelopeBody({
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
            signingOrder: 2,
            signingStatus: 'SIGNED',
            signedAt: '2026-10-08T14:00:00.000Z',
          }),
          recipient({ id: 53, email: 'c@mana.test', signingOrder: null }),
        ],
      }),
    ),
  })
  const state = await client(fetch).get(E)
  assertEquals(state, {
    status: 'REJECTED',
    completedAt: null,
    externalId: 'req-1',
    recipients: [
      {
        id: '51',
        signingOrder: 1,
        signingStatus: 'REJECTED',
        readStatus: 'OPENED',
        signedAt: null,
        rejectionReason: 'Non',
      },
      {
        id: '52',
        signingOrder: 2,
        signingStatus: 'SIGNED',
        readStatus: 'NOT_OPENED',
        signedAt: '2026-10-08T14:00:00.000Z',
        rejectionReason: null,
      },
      {
        id: '53',
        signingOrder: null,
        signingStatus: 'NOT_SIGNED',
        readStatus: 'NOT_OPENED',
        signedAt: null,
        rejectionReason: null,
      },
    ],
    itemId: ITEM,
  })
  const text = JSON.stringify(state)
  assertFalse(text.includes('@'))
  assertFalse(text.includes('token'))
})

Deno.test('get: itemId is the one path-safe item, else null', async () => {
  const item = (id: string) => ({ id, envelopeId: E, documentDataId: 'd' })
  for (
    const [envelopeItems, itemId] of [
      [[item(ITEM)], ITEM],
      [[], null],
      [[item(ITEM), item('envelope_item_b')], null],
      [[item('../../x')], null],
    ] as const
  ) {
    const { fetch } = fakeFetch({
      [GET_E]: json(200, envelopeBody({ envelopeItems })),
    })
    assertEquals((await client(fetch).get(E)).itemId, itemId)
  }
})

Deno.test('get: unknown fields in the read (the rest of Documenso 2.20 envelope) are ignored', async () => {
  const { fetch } = fakeFetch({
    [GET_E]: json(
      200,
      envelopeBody({
        internalVersion: 2,
        source: 'DOCUMENT',
        visibility: 'EVERYONE',
        documentMeta: { id: 'meta_1', language: 'fr', emailSettings: null },
        fields: [{ id: 1, envelopeItemId: ITEM, type: 'SIGNATURE', page: 1 }],
        user: { id: 1, name: 'Clinique', email: 'owner@mana.test' },
        team: { id: 1, url: 'clinique-mana' },
        aNewField: { nested: [1, 2, 3] },
      }),
    ),
  })
  const state = await client(fetch).get(E)
  assertEquals(state.status, 'DRAFT')
  assertEquals(state.recipients.map((r) => r.id), ['51', '52'])
  assertFalse(JSON.stringify(state).includes('@'))
})

Deno.test('get: a read over 1 MB → provider_error (the cap the deprecated document read overran with its embedded PDF)', async () => {
  const { fetch } = fakeFetch({
    [GET_E]: json(
      200,
      envelopeBody({ documentData: { data: 'A'.repeat(1_122_716) } }),
    ),
  })
  const error = await assertRejects(() => client(fetch).get(E), DocumensoError)
  assertEquals([error.code, error.status], ['provider_error', 200])
  assertEquals(error.message, 'Documenso read: unexpected response')
})

Deno.test('get: another envelope in the answer than the one asked → provider_error', async () => {
  const { fetch } = fakeFetch({
    [GET_E]: json(200, envelopeBody({ id: 'envelope_aaaaaaaaaaaaaaab' })),
  })
  const error = await assertRejects(() => client(fetch).get(E), DocumensoError)
  assertEquals([error.code, error.status], ['provider_error', 200])
})

Deno.test("get: notFound is true only for a 404 with Documenso's NOT_FOUND body (E-14)", async () => {
  const cases = [
    [
      json(404, { message: 'Envelope not found', code: 'NOT_FOUND' }),
      404,
      true,
    ],
    [
      () =>
        new Response('<html>404 Not Found</html>', {
          status: 404,
          headers: { 'Content-Type': 'text/html' },
        }),
      404,
      false,
    ],
    [json(404, { message: 'x', code: 'BAD_REQUEST' }), 404, false],
    [json(500, { message: 'boom', code: 'NOT_FOUND' }), 500, false],
    [json(401, { message: 'no' }), 401, false],
  ] as const
  for (const [responder, status, notFound] of cases) {
    const { fetch } = fakeFetch({ [GET_E]: responder })
    const error = await assertRejects(
      () => client(fetch).get(E),
      DocumensoError,
    )
    assertEquals(
      [error.code, error.status, error.notFound],
      [status === 401 ? 'not_configured' : 'provider_error', status, notFound],
    )
  }
  const { fetch } = fakeFetch({
    [GET_E]: () => {
      throw new TypeError('connection refused')
    },
  })
  const error = await assertRejects(() => client(fetch).get(E), DocumensoError)
  assertEquals([error.status, error.notFound], [null, false])
})

Deno.test('notFound: kept through createEnvelope (with its envelope id) and set by the download read', async () => {
  const missing = json(404, {
    message: 'Envelope not found',
    code: 'NOT_FOUND',
  })
  const created = fakeFetch({
    [CREATE]: json(200, { id: E }),
    [GET_E]: missing,
  })
  const error = await assertRejects(
    () => client(created.fetch).createEnvelope(PDF, input()),
    DocumensoError,
  )
  assertEquals([error.status, error.notFound, error.envelopeId], [404, true, E])
  const download = fakeFetch({ [GET_E]: missing })
  const failed = await assertRejects(
    () => client(download.fetch).downloadSigned(E),
    DocumensoError,
  )
  assertEquals([failed.code, failed.status, failed.notFound], [
    'provider_error',
    404,
    true,
  ])
})

Deno.test('get: an envelope without an externalId reads null', async () => {
  const { fetch } = fakeFetch({
    [GET_E]: json(200, envelopeBody({ externalId: null })),
  })
  assertEquals((await client(fetch).get(E)).externalId, null)
})

Deno.test('get: an envelope read without the externalId field → provider_error (a bad response, never « no id »)', async () => {
  const { externalId: _, ...withoutField } = envelopeBody()
  for (const body of [withoutField, envelopeBody({ externalId: 12 })]) {
    const { fetch } = fakeFetch({ [GET_E]: json(200, body) })
    const error = await assertRejects(
      () => client(fetch).get(E),
      DocumensoError,
    )
    assertEquals(error.code, 'provider_error')
    assertEquals(error.message, 'Documenso read: unexpected response')
  }
})

Deno.test('get: an unknown envelope status → provider_error', async () => {
  const { fetch } = fakeFetch({
    [GET_E]: json(200, envelopeBody({ status: 'ARCHIVED' })),
  })
  const error = await assertRejects(
    () => client(fetch).get(E),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
})

// ---------------------------------------------------------------------------
// cancel (E-8)
// ---------------------------------------------------------------------------
const NOT_FOUND = { message: 'Envelope not found', code: 'NOT_FOUND' }
const REFUSED = json(400, { message: 'not pending', code: 'BAD_REQUEST' })

Deno.test('cancel: a pending envelope is cancelled with the reason', async () => {
  const { fetch, calls } = fakeFetch({
    [CANCEL]: [json(200, { success: true }), json(200, { success: true })],
  })
  await client(fetch).cancel(E, { reason: 'Contrat remplacé' })
  await client(fetch).cancel(E)
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [CANCEL, CANCEL])
  assertEquals(JSON.parse(calls[0].body), {
    envelopeId: E,
    reason: 'Contrat remplacé',
  })
  assertEquals(JSON.parse(calls[1].body), { envelopeId: E })
})

Deno.test("cancel: Documenso's 404, then the read-back's 404 too → done (never one 404 alone)", async () => {
  const { fetch, calls } = fakeFetch({
    [CANCEL]: json(404, NOT_FOUND),
    [GET_E]: json(404, NOT_FOUND),
  })
  await client(fetch).cancel(E)
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [CANCEL, GET_E])
})

Deno.test("cancel: Documenso's 404, then the envelope reads back COMPLETED → the cancel's error, nothing deleted", async () => {
  for (const status of ['COMPLETED', 'PENDING', 'REJECTED']) {
    const { fetch, calls } = fakeFetch({
      [CANCEL]: json(404, NOT_FOUND),
      [GET_E]: json(200, envelopeBody({ status })),
    })
    const error = await assertRejects(
      () => client(fetch).cancel(E),
      DocumensoError,
    )
    assertEquals([error.code, error.status, error.notFound], [
      'provider_error',
      404,
      true,
    ])
    assertEquals(calls.map((c) => `${c.method} ${c.url}`), [CANCEL, GET_E])
  }
})

Deno.test("cancel: Documenso's 404, then the envelope reads back DRAFT → deleted; CANCELLED → done", async () => {
  const draft = fakeFetch({
    [CANCEL]: json(404, NOT_FOUND),
    [GET_E]: json(200, envelopeBody({ status: 'DRAFT' })),
    [DELETE]: json(200, { success: true }),
  })
  await client(draft.fetch).cancel(E)
  assertEquals(draft.calls.map((c) => `${c.method} ${c.url}`), [
    CANCEL,
    GET_E,
    DELETE,
  ])
  const cancelled = fakeFetch({
    [CANCEL]: json(404, NOT_FOUND),
    [GET_E]: json(200, envelopeBody({ status: 'CANCELLED' })),
  })
  await client(cancelled.fetch).cancel(E)
})

Deno.test("cancel: a 400 whose read-back is Documenso's 404 → done (the envelope is gone)", async () => {
  const { fetch } = fakeFetch({
    [CANCEL]: REFUSED,
    [GET_E]: json(404, NOT_FOUND),
  })
  await client(fetch).cancel(E)
})

Deno.test("cancel: a 404 that is not Documenso's error (proxy, wrong URL) is an error", async () => {
  const html = () =>
    new Response('<html><body>404 Not Found</body></html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })
  for (
    const responder of [
      html,
      json(404, { message: 'Not found' }),
      json(404, { message: 'x', code: 'BAD_REQUEST' }),
      json(404, 'NOT_FOUND'),
    ]
  ) {
    for (const draft of [false, true]) {
      const { fetch } = fakeFetch({ [CANCEL]: responder, [DELETE]: responder })
      const error = await assertRejects(
        () => client(fetch).cancel(E, { draft }),
        DocumensoError,
      )
      assertEquals([error.code, error.status], ['provider_error', 404])
    }
  }
})

Deno.test('cancel: a 400, then the envelope reads back CANCELLED → done', async () => {
  const { fetch, calls } = fakeFetch({
    [CANCEL]: REFUSED,
    [GET_E]: json(200, envelopeBody({ status: 'CANCELLED' })),
  })
  await client(fetch).cancel(E)
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [CANCEL, GET_E])
})

Deno.test('cancel: a 400, then the envelope reads back DRAFT → deleted (its 404 done once the read-back is gone too)', async () => {
  for (
    const [deleted, after] of [
      [json(200, { success: true }), []],
      [json(404, NOT_FOUND), [GET_E]],
    ] as const
  ) {
    const { fetch, calls } = fakeFetch({
      [CANCEL]: REFUSED,
      [GET_E]: [
        json(200, envelopeBody({ status: 'DRAFT' })),
        json(404, NOT_FOUND),
      ],
      [DELETE]: deleted,
    })
    await client(fetch).cancel(E, { reason: 'Remplacé' })
    assertEquals(calls.map((c) => `${c.method} ${c.url}`), [
      CANCEL,
      GET_E,
      DELETE,
      ...after,
    ])
    assertEquals(JSON.parse(calls[2].body), { envelopeId: E })
  }
})

Deno.test('cancel: draft → deleted straight away, never cancelled; a delete 404 is read back', async () => {
  const { fetch, calls } = fakeFetch({
    [DELETE]: [json(200, { success: true }), json(404, NOT_FOUND)],
    [GET_E]: json(404, NOT_FOUND),
  })
  await client(fetch).cancel(E, { draft: true })
  await client(fetch).cancel(E, { draft: true })
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [
    DELETE,
    DELETE,
    GET_E,
  ])
  assertEquals(JSON.parse(calls[0].body), { envelopeId: E })
})

Deno.test('cancel: a delete 404 whose read-back still shows the envelope → the delete error', async () => {
  const { fetch } = fakeFetch({
    [DELETE]: json(404, NOT_FOUND),
    [GET_E]: json(200, envelopeBody({ status: 'DRAFT' })),
  })
  const error = await assertRejects(
    () => client(fetch).cancel(E, { draft: true }),
    DocumensoError,
  )
  assertEquals([error.message, error.notFound], [
    'Documenso delete failed (404)',
    true,
  ])
})

Deno.test("cancel: a 400 on a completed or rejected envelope, or an unreadable one, is the cancel's error; delete never sent", async () => {
  for (
    const readBack of [
      json(200, envelopeBody({ status: 'COMPLETED' })),
      json(200, envelopeBody({ status: 'REJECTED' })),
      json(200, envelopeBody({ status: 'PENDING' })),
      json(500, {}),
    ]
  ) {
    const { fetch, calls } = fakeFetch({ [CANCEL]: REFUSED, [GET_E]: readBack })
    const error = await assertRejects(
      () => client(fetch).cancel(E),
      DocumensoError,
    )
    assertEquals([error.code, error.status], ['provider_error', 400])
    assertEquals(error.message, 'Documenso cancel failed (400)')
    assertEquals(calls.map((c) => `${c.method} ${c.url}`), [CANCEL, GET_E])
  }
})

Deno.test('cancel: a refused delete is its own error', async () => {
  const { fetch } = fakeFetch({ [DELETE]: json(400, { message: 'no' }) })
  const error = await assertRejects(
    () => client(fetch).cancel(E, { draft: true }),
    DocumensoError,
  )
  assertEquals([error.code, error.status], ['provider_error', 400])
  assertEquals(error.message, 'Documenso delete failed (400)')
})

// ---------------------------------------------------------------------------
// downloadSigned (E-7)
// ---------------------------------------------------------------------------
Deno.test('downloadSigned: with the item id from a get, no second read; a malformed one is refused before any request', async () => {
  const { fetch, calls } = fakeFetch({
    [DOWNLOAD]: () => new Response(PDF),
  })
  assertEquals(await client(fetch).downloadSigned(E, ITEM), PDF)
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [
    `GET ${BASE}/api/v2/envelope/item/${ITEM}/download?version=signed`,
  ])
  const error = await assertRejects(
    () => client(fetch).downloadSigned(E, '../../x'),
    DocumensoError,
  )
  assertEquals([error.code, calls.length], ['provider_error', 1])
})

Deno.test("downloadSigned: reads the envelope, then the one item's signed version, as bytes", async () => {
  const { fetch, calls } = fakeFetch({
    [GET_E]: json(200, envelopeBody({ status: 'COMPLETED' })),
    // Documenso declares JSON for this answer; the bytes are what count.
    [DOWNLOAD]: () =>
      new Response(PDF, { headers: { 'Content-Type': 'application/json' } }),
  })
  assertEquals(await client(fetch).downloadSigned(E), PDF)
  assertEquals(calls.map((c) => c.url), [
    `${BASE}/api/v2/envelope/${E}`,
    `${BASE}/api/v2/envelope/item/${ITEM}/download?version=signed`,
  ])
})

Deno.test('downloadSigned: zero or two items, or a malformed item id → provider_error, no download request', async () => {
  const item = (id: string) => ({ id, envelopeId: E, documentDataId: 'd' })
  for (
    const envelopeItems of [
      [],
      [item(ITEM), item('envelope_item_b')],
      [item('../../document/12')],
      [item('a'.repeat(101))],
      [item('')],
    ]
  ) {
    const { fetch, calls } = fakeFetch({
      [GET_E]: json(200, envelopeBody({ status: 'COMPLETED', envelopeItems })),
    })
    const error = await assertRejects(
      () => client(fetch).downloadSigned(E),
      DocumensoError,
    )
    assertEquals([error.code, error.status], ['provider_error', 200])
    assertEquals(calls.length, 1)
  }
})

Deno.test('downloadSigned: a body that is not a PDF → provider_error', async () => {
  const { fetch } = fakeFetch({
    [GET_E]: json(200, envelopeBody({ status: 'COMPLETED' })),
    [DOWNLOAD]: json(200, { downloadUrl: 'https://s3.test/x' }),
  })
  const error = await assertRejects(
    () => client(fetch).downloadSigned(E),
    DocumensoError,
  )
  assertEquals(error.code, 'provider_error')
})

Deno.test('downloadSigned: over maxDownloadBytes → provider_error (declared or streamed)', async () => {
  const big = new Uint8Array(64).fill(0x20)
  big.set(PDF)
  const { fetch } = fakeFetch({
    [GET_E]: json(200, envelopeBody({ status: 'COMPLETED' })),
    [DOWNLOAD]: [
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
      () => c.downloadSigned(E),
      DocumensoError,
    )
    assertEquals(error.code, 'provider_error')
  }
})

// ---------------------------------------------------------------------------
// ping (E-9)
// ---------------------------------------------------------------------------
Deno.test('ping: GET /api/v2/envelope?perPage=1; 200 → ok; 401 → { ok: false, status: 401 }', async () => {
  const { fetch, calls } = fakeFetch({
    [LIST]: [json(200, { data: [] }), json(401, { message: 'Unauthorized' })],
  })
  const c = client(fetch)
  assertEquals(await c.ping(), { ok: true })
  assertEquals(await c.ping(), { ok: false, status: 401 })
  assertEquals(calls[0].url, `${BASE}/api/v2/envelope?perPage=1`)
})

Deno.test("ping: a 200 that is not Documenso's list → provider_error", async () => {
  for (
    const responder of [
      () => new Response('<html>Welcome to nginx</html>'),
      json(200, { data: 'x' }),
      json(200, [{ id: 1 }]),
    ]
  ) {
    const { fetch } = fakeFetch({ [LIST]: responder })
    const error = await assertRejects(
      () => client(fetch).ping(),
      DocumensoError,
    )
    assertEquals([error.code, error.status], ['provider_error', 200])
  }
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
const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'

Deno.test('documensoEventId: terminal events ignore the version', () => {
  assertEquals(
    documensoEventId(ORG_A, 'DOCUMENT_COMPLETED', E, 'x'),
    `${ORG_A}:DOCUMENT_COMPLETED:${E}`,
  )
  assertEquals(
    documensoEventId(ORG_A, 'DOCUMENT_REJECTED', E, '2026-10-08T14:00:00.000Z'),
    `${ORG_A}:DOCUMENT_REJECTED:${E}`,
  )
  assertEquals(
    documensoEventId(ORG_A, 'DOCUMENT_CANCELLED', E, null),
    `${ORG_A}:DOCUMENT_CANCELLED:${E}`,
  )
})

Deno.test('documensoEventId: other events include the version (or « unversioned »)', () => {
  assertEquals(
    documensoEventId(ORG_A, 'DOCUMENT_OPENED', E, '2026-10-08T14:00:00.000Z'),
    `${ORG_A}:DOCUMENT_OPENED:${E}:2026-10-08T14:00:00.000Z`,
  )
  assertEquals(
    documensoEventId(ORG_A, 'DOCUMENT_SIGNED', E, null),
    `${ORG_A}:DOCUMENT_SIGNED:${E}:unversioned`,
  )
})

Deno.test('documensoEventId: the same envelope id at two clinics (two instances) is two events', () => {
  const a = documensoEventId(ORG_A, 'DOCUMENT_COMPLETED', E, null)
  const b = documensoEventId(ORG_B, 'DOCUMENT_COMPLETED', E, null)
  assertEquals(a === b, false)
  assertEquals(b, `${ORG_B}:DOCUMENT_COMPLETED:${E}`)
})

Deno.test('documensoEventId: the worst-case id is 200 characters (webhook_events.event_id)', () => {
  // A 64-character event name, the longest ENVELOPE_ID, an ISO version (24).
  const event = `DOCUMENT_${'X'.repeat(55)}`
  assertEquals(event.length, 64)
  const worst = documensoEventId(
    ORG_A,
    event,
    `envelope_${'a'.repeat(64)}`,
    new Date(0).toISOString(),
  )
  assert(isEnvelopeId(`envelope_${'a'.repeat(64)}`))
  assertEquals(worst.length, 200)
})
