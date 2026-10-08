/**
 * An in-memory Documenso for Deno tests: a `fetch` that serves the paths of
 * `DOCUMENSO_PATHS` (`../documenso.ts`), with a call log like `fakeFetch`.
 * Test-only: never deployed.
 *
 * Same behaviour as `scripts/fake-documenso.mjs` (keep the two in step):
 * - `Authorization` must be the key (no `Bearer`), else 401;
 * - ids are deterministic: documents 1, 2, …; recipients 101, 102, …;
 *   timestamps tick one second per change from 2026-01-01T12:00:00Z;
 * - fields only on a draft; `distribute` needs a SIGNATURE field per signer
 *   (as Documenso does) and is a no-op on a pending document;
 * - `cancel` (delete): a draft disappears, a pending or rejected document
 *   becomes CANCELLED, a cancelled one answers 404, a completed one 400;
 * - the signed download is the uploaded PDF plus a trailing comment, so it
 *   differs from the source and still ends with `%%EOF` nearby.
 *
 * Instead of the script's admin routes, tests call `open` / `sign` /
 * `complete` / `reject`, then build the webhook with `webhookRequest`.
 */
import { DOCUMENSO_PATHS, type DocumensoDocumentStatus } from '../documenso.ts'
import type { FetchCall } from './fake-fetch.ts'

/** The fake's API operations, for `failures`. */
export type FakeDocumensoOperation =
  | 'create'
  | 'read'
  | 'fields'
  | 'distribute'
  | 'redistribute'
  | 'cancel'
  | 'download'
  | 'list'

export interface FakeDocumensoRecipient {
  id: string
  email: string
  name: string
  role: string
  signingOrder: number
  readStatus: 'NOT_OPENED' | 'OPENED'
  signingStatus: 'NOT_SIGNED' | 'SIGNED' | 'REJECTED'
  sendStatus: 'NOT_SENT' | 'SENT'
  signedAt: string | null
  rejectionReason: string | null
}

export interface FakeDocumensoField {
  recipientId: string
  type: string
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface FakeDocumensoDocument {
  id: string
  externalId: string | null
  title: string
  status: DocumensoDocumentStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
  meta: Record<string, unknown>
  pdf: Uint8Array
  recipients: FakeDocumensoRecipient[]
  fields: FakeDocumensoField[]
}

export interface FakeDocumenso {
  fetch: typeof fetch
  calls: FetchCall[]
  /** By id; a deleted draft is removed. */
  documents: Map<string, FakeDocumensoDocument>
  /** An HTTP status to answer for an operation instead of the normal reply, until deleted. */
  failures: Partial<Record<FakeDocumensoOperation, number>>
  /** Requests being served now, and the most at once. */
  inFlight: { current: number; max: number }
  /** A recipient (default: the first not opened) opens the document. */
  open(documentId: string, recipientId?: string): void
  /** A recipient (default: the next to sign) signs; the document stays pending. */
  sign(documentId: string, recipientId?: string): void
  /** Every recipient has signed: the document is COMPLETED. */
  complete(documentId: string): void
  /** A recipient (default: the next to sign) rejects the document. */
  reject(documentId: string, recipientId?: string, reason?: string): void
  /** The webhook Documenso would POST for `event` on this document, signed with the secret. */
  webhookRequest(url: string, event: string, documentId: string): Request
}

export interface FakeDocumensoOptions {
  baseUrl?: string
  apiKey?: string
  webhookSecret?: string
  /** Delay inside each request, so concurrent calls overlap (default 0). */
  latencyMs?: number
  /** Serves requests to any other origin; without it they throw. */
  fallback?: typeof fetch
}

const START = Date.parse('2026-01-01T12:00:00.000Z')
const SIGNED_SUFFIX = (id: string) => `\n% fake-documenso: signed ${id}\n`

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const failure = (status: number, message: string) =>
  json(status, { message, code: status === 401 ? 'UNAUTHORIZED' : 'ERROR' })

const inPercent = (v: unknown, min: number) =>
  typeof v === 'number' && v >= min && v <= 100

/** Builds the fake; defaults match the local seed (`local-dev-…`, port 55390). */
export function fakeDocumenso(
  options: FakeDocumensoOptions = {},
): FakeDocumenso {
  const baseUrl = (options.baseUrl ?? 'http://host.docker.internal:55390')
    .replace(/\/+$/, '')
  const origin = new URL(baseUrl).origin
  const apiKey = options.apiKey ?? 'local-dev-documenso-key'
  const webhookSecret = options.webhookSecret ??
    'local-dev-documenso-webhook-secret'
  const calls: FetchCall[] = []
  const documents = new Map<string, FakeDocumensoDocument>()
  const failures: FakeDocumenso['failures'] = {}
  const inFlight = { current: 0, max: 0 }
  let nextDocument = 1
  let nextRecipient = 101
  let ticks = 0
  const tick = () => new Date(START + 1000 * ticks++).toISOString()

  const documentJson = (doc: FakeDocumensoDocument) => ({
    id: Number(doc.id),
    envelopeId: `envelope_${doc.id}`,
    externalId: doc.externalId,
    title: doc.title,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    completedAt: doc.completedAt,
    documentMeta: doc.meta,
    recipients: doc.recipients.map((r) => ({
      ...r,
      id: Number(r.id),
      documentId: Number(doc.id),
    })),
    fields: doc.fields.map((f) => ({
      recipientId: Number(f.recipientId),
      type: f.type,
      page: f.page,
      positionX: f.x,
      positionY: f.y,
      width: f.width,
      height: f.height,
    })),
  })

  async function body(req: Request): Promise<Record<string, unknown>> {
    try {
      const value = await req.json()
      return value !== null && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  const find = (id: unknown) => documents.get(String(id))

  async function create(req: Request): Promise<Response> {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return failure(400, 'Expected multipart/form-data')
    }
    const file = form.get('file')
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(String(form.get('payload')))
    } catch {
      return failure(400, 'Invalid payload')
    }
    const recipients = Array.isArray(payload.recipients)
      ? payload.recipients as Record<string, unknown>[]
      : []
    if (!(file instanceof File) || typeof payload.title !== 'string') {
      return failure(400, 'Missing file or title')
    }
    const pdf = new Uint8Array(await file.arrayBuffer())
    if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') {
      return failure(400, 'The file is not a PDF')
    }
    const id = String(nextDocument++)
    const at = tick()
    documents.set(id, {
      id,
      externalId: typeof payload.externalId === 'string'
        ? payload.externalId
        : null,
      title: payload.title,
      status: 'DRAFT',
      createdAt: at,
      updatedAt: at,
      completedAt: null,
      meta: (payload.meta ?? {}) as Record<string, unknown>,
      pdf,
      recipients: recipients.map((r, i) => ({
        id: String(nextRecipient++),
        email: String(r.email),
        name: String(r.name),
        role: String(r.role ?? 'SIGNER'),
        signingOrder: Number(r.signingOrder ?? i + 1),
        readStatus: 'NOT_OPENED',
        signingStatus: 'NOT_SIGNED',
        sendStatus: 'NOT_SENT',
        signedAt: null,
        rejectionReason: null,
      })),
      fields: [],
    })
    return json(200, { id: Number(id), envelopeId: `envelope_${id}` })
  }

  async function addFields(req: Request): Promise<Response> {
    const input = await body(req)
    const doc = find(input.documentId)
    if (!doc) return failure(404, 'Document not found')
    if (doc.status !== 'DRAFT') return failure(400, 'Document is not a draft')
    const fields = Array.isArray(input.fields)
      ? input.fields as Record<string, unknown>[]
      : []
    const valid = fields.every((f) =>
      doc.recipients.some((r) => r.id === String(f.recipientId)) &&
      Number.isInteger(f.pageNumber) && Number(f.pageNumber) >= 1 &&
      inPercent(f.pageX, 0) && inPercent(f.pageY, 0) &&
      inPercent(f.width, 1) && inPercent(f.height, 1)
    )
    if (!valid || fields.length === 0) return failure(400, 'Invalid fields')
    for (const f of fields) {
      doc.fields.push({
        recipientId: String(f.recipientId),
        type: String(f.type),
        page: Number(f.pageNumber),
        x: Number(f.pageX),
        y: Number(f.pageY),
        width: Number(f.width),
        height: Number(f.height),
      })
    }
    doc.updatedAt = tick()
    return json(200, { fields: documentJson(doc).fields })
  }

  async function distribute(req: Request): Promise<Response> {
    const doc = find((await body(req)).documentId)
    if (!doc) return failure(404, 'Document not found')
    if (doc.status === 'PENDING') return json(200, documentJson(doc))
    if (doc.status !== 'DRAFT') return failure(400, 'Document is not a draft')
    const unsigned = doc.recipients.some((r) =>
      r.role === 'SIGNER' &&
      !doc.fields.some((f) => f.recipientId === r.id && f.type === 'SIGNATURE')
    )
    if (unsigned) return failure(400, 'Signers need a signature field')
    doc.status = 'PENDING'
    for (const r of doc.recipients) r.sendStatus = 'SENT'
    doc.updatedAt = tick()
    return json(200, documentJson(doc))
  }

  async function redistribute(req: Request): Promise<Response> {
    const input = await body(req)
    const doc = find(input.documentId)
    if (!doc) return failure(404, 'Document not found')
    const ids = Array.isArray(input.recipients) ? input.recipients : []
    if (
      doc.status !== 'PENDING' || ids.length === 0 ||
      !ids.every((id) => doc.recipients.some((r) => r.id === String(id)))
    ) {
      return failure(400, 'Cannot redistribute')
    }
    return json(200, { success: true })
  }

  async function cancel(req: Request): Promise<Response> {
    const doc = find((await body(req)).documentId)
    if (!doc || doc.status === 'CANCELLED') {
      return failure(404, 'Document not found')
    }
    if (doc.status === 'COMPLETED') {
      return failure(400, 'A completed document cannot be deleted')
    }
    if (doc.status === 'DRAFT') documents.delete(doc.id)
    else {
      doc.status = 'CANCELLED'
      doc.updatedAt = tick()
    }
    return json(200, { success: true })
  }

  function download(id: string, url: URL): Response {
    const doc = find(id)
    if (!doc) return failure(404, 'Document not found')
    if (url.searchParams.get('version') === 'original') {
      return new Response(doc.pdf as Uint8Array<ArrayBuffer>, {
        headers: { 'Content-Type': 'application/pdf' },
      })
    }
    if (doc.status !== 'COMPLETED') {
      return failure(400, 'Document is not completed')
    }
    const suffix = new TextEncoder().encode(SIGNED_SUFFIX(doc.id))
    const signed = new Uint8Array(doc.pdf.length + suffix.length)
    signed.set(doc.pdf)
    signed.set(suffix, doc.pdf.length)
    return new Response(signed, {
      headers: { 'Content-Type': 'application/pdf' },
    })
  }

  function list(url: URL): Response {
    const perPage = Math.max(1, Number(url.searchParams.get('perPage')) || 10)
    const all = [...documents.values()]
    return json(200, {
      data: all.slice(0, perPage).map(documentJson),
      count: all.length,
      currentPage: 1,
      perPage,
      totalPages: Math.max(1, Math.ceil(all.length / perPage)),
    })
  }

  /** The operation a request names, and the document id in its path. */
  function operationOf(
    req: Request,
    path: string,
  ): [FakeDocumensoOperation, string] | null {
    const post = req.method === 'POST'
    if (post && path === DOCUMENSO_PATHS.create) return ['create', '']
    if (post && path === DOCUMENSO_PATHS.fields) return ['fields', '']
    if (post && path === DOCUMENSO_PATHS.distribute) return ['distribute', '']
    if (post && path === DOCUMENSO_PATHS.redistribute) {
      return ['redistribute', '']
    }
    if (post && path === DOCUMENSO_PATHS.cancel) return ['cancel', '']
    if (req.method !== 'GET') return null
    if (path === DOCUMENSO_PATHS.list) return ['list', '']
    const download = /^\/api\/v2\/document\/(\d+)\/download$/.exec(path)
    if (download) return ['download', download[1]]
    const read = /^\/api\/v2\/document\/(\d+)$/.exec(path)
    return read ? ['read', read[1]] : null
  }

  async function serve(req: Request): Promise<Response> {
    if (req.headers.get('Authorization') !== apiKey) {
      return failure(401, 'Unauthorized')
    }
    const url = new URL(req.url)
    const match = operationOf(req, url.pathname)
    if (!match) return failure(404, 'Not found')
    const [operation, id] = match
    const failed = failures[operation]
    if (failed !== undefined) return failure(failed, 'Injected failure')
    switch (operation) {
      case 'create':
        return await create(req)
      case 'fields':
        return await addFields(req)
      case 'distribute':
        return await distribute(req)
      case 'redistribute':
        return await redistribute(req)
      case 'cancel':
        return await cancel(req)
      case 'download':
        return download(id, url)
      case 'list':
        return list(url)
      case 'read': {
        const doc = find(id)
        return doc ? json(200, documentJson(doc)) : failure(404, 'Not found')
      }
    }
  }

  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    if (new URL(req.url).origin !== origin) {
      if (options.fallback) return await options.fallback(input, init)
      throw new Error(`fake-documenso: no route for ${req.method} ${req.url}`)
    }
    calls.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: await req.clone().text(),
    })
    inFlight.current++
    inFlight.max = Math.max(inFlight.max, inFlight.current)
    try {
      if (options.latencyMs) {
        await new Promise((resolve) => setTimeout(resolve, options.latencyMs))
      }
      return await serve(req)
    } finally {
      inFlight.current--
    }
  }

  function pending(documentId: string): FakeDocumensoDocument {
    const doc = documents.get(documentId)
    if (!doc) throw new Error(`fake-documenso: no document ${documentId}`)
    if (doc.status !== 'PENDING') {
      throw new Error(`fake-documenso: document ${documentId} is ${doc.status}`)
    }
    return doc
  }

  function recipientOf(
    doc: FakeDocumensoDocument,
    recipientId: string | undefined,
    pick: (r: FakeDocumensoRecipient) => boolean,
  ): FakeDocumensoRecipient {
    const ordered = [...doc.recipients].sort((a, b) =>
      a.signingOrder - b.signingOrder
    )
    const recipient = recipientId === undefined
      ? ordered.find(pick)
      : doc.recipients.find((r) => r.id === recipientId)
    if (!recipient) throw new Error('fake-documenso: no such recipient')
    return recipient
  }

  return {
    fetch: fake as typeof fetch,
    calls,
    documents,
    failures,
    inFlight,
    open(documentId, recipientId) {
      const doc = pending(documentId)
      recipientOf(doc, recipientId, (r) => r.readStatus === 'NOT_OPENED')
        .readStatus = 'OPENED'
      doc.updatedAt = tick()
    },
    sign(documentId, recipientId) {
      const doc = pending(documentId)
      const r = recipientOf(
        doc,
        recipientId,
        (r) => r.signingStatus === 'NOT_SIGNED',
      )
      const at = tick()
      Object.assign(r, {
        readStatus: 'OPENED',
        signingStatus: 'SIGNED',
        signedAt: at,
      })
      doc.updatedAt = at
    },
    complete(documentId) {
      const doc = pending(documentId)
      const at = tick()
      for (const r of doc.recipients) {
        if (r.signingStatus !== 'SIGNED') {
          Object.assign(r, {
            readStatus: 'OPENED',
            signingStatus: 'SIGNED',
            signedAt: at,
          })
        }
      }
      Object.assign(doc, {
        status: 'COMPLETED',
        completedAt: at,
        updatedAt: at,
      })
    },
    reject(documentId, recipientId, reason = 'Je ne signe pas ce document.') {
      const doc = pending(documentId)
      const r = recipientOf(
        doc,
        recipientId,
        (r) => r.signingStatus === 'NOT_SIGNED',
      )
      Object.assign(r, {
        readStatus: 'OPENED',
        signingStatus: 'REJECTED',
        rejectionReason: reason,
      })
      Object.assign(doc, { status: 'REJECTED', updatedAt: tick() })
    },
    webhookRequest(url, event, documentId) {
      const doc = documents.get(documentId)
      if (!doc) throw new Error(`fake-documenso: no document ${documentId}`)
      const { fields: _fields, ...payload } = documentJson(doc)
      return new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Documenso-Secret': webhookSecret,
        },
        body: JSON.stringify({
          event,
          payload,
          createdAt: tick(),
          webhookEndpoint: url,
        }),
      })
    },
  }
}
