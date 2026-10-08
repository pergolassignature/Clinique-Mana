/**
 * An in-memory Documenso: a `fetch` that serves the paths of
 * `DOCUMENSO_PATHS` (`../documenso.ts`, the v2 envelope family), with a call
 * log like `fakeFetch`. Never deployed. It is the one fake: Deno tests use it
 * directly, and `npm run fake:documenso` serves it over HTTP for local
 * development (`scripts/fake-documenso.ts`, through
 * `./fake-documenso-server.ts`, which adds the admin routes and posts the
 * webhooks).
 *
 * Behaviour:
 * - `Authorization` must be the key (no `Bearer`), else 401;
 * - ids are deterministic and shaped like Documenso 2.20's (plan E-12):
 *   envelopes `envelope_` + 16 letters of its alphabet (`envelope_aaaaaaaaaaaaaaab`,
 *   …ac, …), each with one item `envelope_item_…` of the same suffix and a
 *   legacy numeric id (1, 2, …) that only webhook payloads carry; recipients
 *   101, 102, …; timestamps tick one second per change from
 *   2026-01-01T12:00:00Z;
 * - `create` takes the fields inline (E-5): each must name the one file
 *   (`identifier` 0, or none), a page from 1 and a box within 0–100 %, else
 *   400; `distribute` needs a SIGNATURE field per signer (as Documenso does)
 *   and is a no-op on a pending envelope; its answer carries each recipient's
 *   `token` and `signingUrl`, as Documenso's does (the client never reads it);
 * - `cancel`: a pending envelope becomes CANCELLED (and stays); any other
 *   status answers 400, an unknown envelope 404;
 * - `delete`: a draft disappears; an unknown one answers 404; any other status
 *   400 (the client never deletes one, E-8: the fake refuses so a test sees it);
 * - cancelling a pending envelope reports DOCUMENT_CANCELLED to `onEvent`, as
 *   Documenso fires that webhook;
 * - errors have Documenso's shape, `{ message, code }`, with the tRPC code
 *   (`NOT_FOUND` for 404, `UNAUTHORIZED`, `BAD_REQUEST`…);
 * - reads carry what Documenso's do and the client must ignore (recipient
 *   tokens, the owner); items carry a `documentDataId`, never the file;
 * - the download is the item's `signed` version of a completed envelope only:
 *   the uploaded PDF plus a trailing comment, so it differs from the source
 *   and still ends with `%%EOF` nearby.
 *
 * Tests call `open` / `sign` / `complete` / `reject`, then build the webhook
 * with `webhookRequest` (Documenso's payload: the legacy numeric `id`,
 * `envelopeId`, recipients with their tokens, the legacy `Recipient` copy).
 */
import { DOCUMENSO_PATHS, type DocumensoEnvelopeStatus } from '../documenso.ts'
import type { FetchCall } from './fake-fetch.ts'

/** The fake's API operations, for `failures`. */
export type FakeDocumensoOperation =
  | 'create'
  | 'read'
  | 'distribute'
  | 'redistribute'
  | 'cancel'
  | 'delete'
  | 'download'
  | 'list'

/** A recipient as the fake stores it (and returns it, ids as numbers). */
export interface FakeDocumensoRecipient {
  /** `101`, `102`, … across the fake's envelopes. */
  id: string
  email: string
  name: string
  role: string
  /** 1-based, from the create payload (else the list order). */
  signingOrder: number
  readStatus: 'NOT_OPENED' | 'OPENED'
  signingStatus: 'NOT_SIGNED' | 'SIGNED' | 'REJECTED'
  sendStatus: 'NOT_SENT' | 'SENT'
  signedAt: string | null
  rejectionReason: string | null
  /** The signing token Documenso emails; reads and webhooks carry it. */
  token: string
}

/** A placed field, as the create payload sent it (percent of the page). */
export interface FakeDocumensoField {
  recipientId: string
  type: string
  /** The file it names: 0 (or omitted, null). */
  identifier: number | string | null
  /** 1-based. */
  page: number
  positionX: number
  positionY: number
  width: number
  height: number
}

/** An envelope as the fake stores it. */
export interface FakeDocumensoDocument {
  /** `envelope_…`: the id every API route takes. */
  id: string
  /** Documenso's legacy document id: webhook payloads only. */
  legacyId: number
  /** The envelope's one file. */
  items: { id: string }[]
  /**
   * From the create payload, else null. Set it to `undefined` and reads omit
   * the field, as a Documenso without it would (the client's bad response).
   */
  externalId: string | null | undefined
  title: string
  status: DocumensoEnvelopeStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
  /** The create payload's `meta`, as sent (`dateFormat`, `envelopeExpirationPeriod`…). */
  meta: Record<string, unknown>
  /** The uploaded PDF. */
  pdf: Uint8Array
  recipients: FakeDocumensoRecipient[]
  fields: FakeDocumensoField[]
}

/** The fake: its `fetch`, its state, and the signer actions tests drive. */
export interface FakeDocumenso {
  /** The origin it answers (`options.baseUrl` without a trailing slash). */
  baseUrl: string
  /** Serves `baseUrl`; other origins go to `options.fallback`, else throw. */
  fetch: typeof fetch
  /** Every request to `baseUrl`, in order (bodies read from a clone). */
  calls: FetchCall[]
  /** By envelope id; a deleted draft is removed. */
  documents: Map<string, FakeDocumensoDocument>
  /** An HTTP status to answer for an operation instead of the normal reply, until deleted. */
  failures: Partial<Record<FakeDocumensoOperation, number>>
  /** Requests being served now, and the most at once. */
  inFlight: { current: number; max: number }
  /** A recipient (default: the first not opened) opens the envelope. */
  open(envelopeId: string, recipientId?: string): void
  /** A recipient (default: the next to sign) signs; the envelope stays pending. */
  sign(envelopeId: string, recipientId?: string): void
  /** Every recipient has signed: the envelope is COMPLETED. */
  complete(envelopeId: string): void
  /** A recipient (default: the next to sign) rejects the envelope. */
  reject(envelopeId: string, recipientId?: string, reason?: string): void
  /** The webhook Documenso would POST for `event` on this envelope, signed with the secret. */
  webhookRequest(url: string, event: string, envelopeId: string): Request
}

/** Options of `fakeDocumenso`; the defaults match the local seed. */
export interface FakeDocumensoOptions {
  /**
   * Default `http://host.docker.internal:55390`, the seed's
   * `signing_settings.base_url`: edge functions run in Docker and reach a
   * fake on the host through `host.docker.internal`. OrbStack and Docker
   * Desktop provide that name; Linux Docker does not (use the host's bridge
   * address, e.g. `http://172.17.0.1:55390`, and serve the fake on it).
   */
  baseUrl?: string
  /** Default `local-dev-documenso-key`. */
  apiKey?: string
  /** Sent as `X-Documenso-Secret`; default `local-dev-documenso-webhook-secret`. */
  webhookSecret?: string
  /** Delay inside each request, so concurrent calls overlap (default 0). */
  latencyMs?: number
  /** Serves requests to any other origin; without it they throw. */
  fallback?: typeof fetch
  /**
   * Called when Documenso would fire a webhook on its own after an API call
   * (DOCUMENT_CANCELLED when a pending envelope is cancelled), after the
   * answer is built.
   */
  onEvent?: (event: string, envelopeId: string) => void
}

const START = Date.parse('2026-01-01T12:00:00.000Z')
const SIGNED_SUFFIX = (id: string) => `\n% fake-documenso: signed ${id}\n`
/** Documenso 2.20's id alphabet (`prefixedId`, plan §1). */
const ALPHABET = 'abcdefhiklmnorstuvwxyz'

/** `n` in Documenso's alphabet, 16 letters (`aaaaaaaaaaaaaaab` for 1). */
function suffix(n: number): string {
  let out = ''
  for (let rest = n; rest > 0; rest = Math.floor(rest / ALPHABET.length)) {
    out = ALPHABET[rest % ALPHABET.length] + out
  }
  return out.padStart(16, ALPHABET[0])
}

/** The id of a fake's `n`th envelope (1-based): `envelope_aaaaaaaaaaaaaaab` for 1. */
export function fakeEnvelopeId(n: number): string {
  return `envelope_${suffix(n)}`
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
/** tRPC error codes by status, as Documenso's OpenAPI errors carry them. */
const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
}
const failure = (status: number, message: string) =>
  json(status, { message, code: CODES[status] ?? 'INTERNAL_SERVER_ERROR' })

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

  /** A recipient as reads and webhooks carry it (token included). */
  const recipientJson = (
    doc: FakeDocumensoDocument,
    r: FakeDocumensoRecipient,
  ) => ({
    ...r,
    id: Number(r.id),
    envelopeId: doc.id,
    expiresAt: null,
    expired: null,
  })

  /** `GET /api/v2/envelope/{id}`, in the parts the client and tests touch. */
  const envelopeJson = (doc: FakeDocumensoDocument) => ({
    id: doc.id,
    secondaryId: `document_${doc.legacyId}`,
    type: 'DOCUMENT',
    externalId: doc.externalId,
    title: doc.title,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    completedAt: doc.completedAt,
    documentMeta: doc.meta,
    recipients: doc.recipients.map((r) => recipientJson(doc, r)),
    fields: doc.fields.map((f) => ({
      envelopeId: doc.id,
      envelopeItemId: doc.items[0].id,
      recipientId: Number(f.recipientId),
      type: f.type,
      page: f.page,
      positionX: f.positionX,
      positionY: f.positionY,
      width: f.width,
      height: f.height,
    })),
    envelopeItems: doc.items.map((item, order) => ({
      id: item.id,
      envelopeId: doc.id,
      documentDataId: `data_${item.id}`,
      title: 'document.pdf',
      order,
    })),
    // The owner: Documenso's reads name them; the client drops it.
    user: { id: 1, name: 'Clinique MANA', email: 'owner@mana.test' },
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

  /** The create payload's inline fields, or null when one is invalid. */
  function fieldsOf(
    recipient: Record<string, unknown>,
    recipientId: string,
  ): FakeDocumensoField[] | null {
    const fields = Array.isArray(recipient.fields)
      ? recipient.fields as Record<string, unknown>[]
      : []
    const valid = fields.every((f) =>
      (f.identifier === undefined || f.identifier === 0) &&
      typeof f.type === 'string' &&
      Number.isInteger(f.page) && Number(f.page) >= 1 &&
      inPercent(f.positionX, 0) && inPercent(f.positionY, 0) &&
      inPercent(f.width, 1) && inPercent(f.height, 1)
    )
    if (!valid) return null
    return fields.map((f) => ({
      recipientId,
      type: String(f.type),
      identifier: f.identifier === undefined ? null : Number(f.identifier),
      page: Number(f.page),
      positionX: Number(f.positionX),
      positionY: Number(f.positionY),
      width: Number(f.width),
      height: Number(f.height),
    }))
  }

  async function create(req: Request): Promise<Response> {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return failure(400, 'Expected multipart/form-data')
    }
    const files = form.getAll('files')
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(String(form.get('payload')))
    } catch {
      return failure(400, 'Invalid payload')
    }
    const recipients = Array.isArray(payload.recipients)
      ? payload.recipients as Record<string, unknown>[]
      : []
    if (
      files.length !== 1 || !(files[0] instanceof File) ||
      typeof payload.title !== 'string' || payload.type !== 'DOCUMENT'
    ) {
      return failure(400, 'One file, a title and type DOCUMENT are required')
    }
    const pdf = new Uint8Array(await files[0].arrayBuffer())
    if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') {
      return failure(400, 'The file is not a PDF')
    }
    const stored = recipients.map((r, i) => {
      const id = String(nextRecipient + i)
      return {
        recipient: {
          id,
          email: String(r.email),
          name: String(r.name),
          role: String(r.role ?? 'SIGNER'),
          signingOrder: Number(r.signingOrder ?? i + 1),
          readStatus: 'NOT_OPENED',
          signingStatus: 'NOT_SIGNED',
          sendStatus: 'NOT_SENT',
          signedAt: null,
          rejectionReason: null,
          token: `token-${id}`,
        } satisfies FakeDocumensoRecipient,
        fields: fieldsOf(r, id),
      }
    })
    if (stored.some((s) => s.fields === null)) {
      return failure(400, 'Invalid fields')
    }
    nextRecipient += recipients.length
    const legacyId = nextDocument++
    const id = fakeEnvelopeId(legacyId)
    const at = tick()
    documents.set(id, {
      id,
      legacyId,
      items: [{ id: `envelope_item_${suffix(legacyId)}` }],
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
      recipients: stored.map((s) => s.recipient),
      fields: stored.flatMap((s) => s.fields ?? []),
    })
    return json(200, { id })
  }

  /** Documenso's distribute answer: tokens and signing URLs included. */
  const distributedJson = (doc: FakeDocumensoDocument) => ({
    success: true,
    id: doc.id,
    recipients: doc.recipients.map((r) => ({
      id: Number(r.id),
      name: r.name,
      email: r.email,
      token: r.token,
      role: r.role,
      signingOrder: r.signingOrder,
      signingUrl: `${baseUrl}/sign/${r.token}`,
    })),
  })

  async function distribute(req: Request): Promise<Response> {
    const doc = find((await body(req)).envelopeId)
    if (!doc) return failure(404, 'Envelope not found')
    if (doc.status === 'PENDING') return json(200, distributedJson(doc))
    if (doc.status !== 'DRAFT') return failure(400, 'Envelope is not a draft')
    const unsigned = doc.recipients.some((r) =>
      r.role === 'SIGNER' &&
      !doc.fields.some((f) => f.recipientId === r.id && f.type === 'SIGNATURE')
    )
    if (unsigned) return failure(400, 'Signers need a signature field')
    doc.status = 'PENDING'
    for (const r of doc.recipients) r.sendStatus = 'SENT'
    doc.updatedAt = tick()
    return json(200, distributedJson(doc))
  }

  async function redistribute(req: Request): Promise<Response> {
    const input = await body(req)
    const doc = find(input.envelopeId)
    if (!doc) return failure(404, 'Envelope not found')
    const ids = Array.isArray(input.recipients) ? input.recipients : []
    if (
      doc.status !== 'PENDING' || ids.length === 0 ||
      !ids.every((id) =>
        typeof id === 'number' &&
        doc.recipients.some((r) => r.id === String(id))
      )
    ) {
      return failure(400, 'Cannot redistribute')
    }
    return json(200, distributedJson(doc))
  }

  async function deleteEnvelope(req: Request): Promise<Response> {
    const doc = find((await body(req)).envelopeId)
    if (!doc) return failure(404, 'Envelope not found')
    if (doc.status !== 'DRAFT') {
      return failure(400, 'The fake deletes drafts only')
    }
    documents.delete(doc.id)
    return json(200, { success: true })
  }

  async function cancelEnvelope(req: Request): Promise<Response> {
    const doc = find((await body(req)).envelopeId)
    if (!doc) return failure(404, 'Envelope not found')
    if (doc.status !== 'PENDING') {
      return failure(400, 'Only a pending envelope can be cancelled')
    }
    doc.status = 'CANCELLED'
    doc.updatedAt = tick()
    // Documenso fires the webhook after answering.
    queueMicrotask(() => options.onEvent?.('DOCUMENT_CANCELLED', doc.id))
    return json(200, { success: true })
  }

  function download(itemId: string, url: URL): Response {
    const doc = [...documents.values()].find((d) =>
      d.items.some((item) => item.id === itemId)
    )
    if (!doc) return failure(404, 'Envelope item not found')
    if ((url.searchParams.get('version') ?? 'signed') !== 'signed') {
      return failure(400, 'The fake serves the signed version only')
    }
    if (doc.status !== 'COMPLETED') {
      return failure(400, 'Envelope is not completed')
    }
    const tail = new TextEncoder().encode(SIGNED_SUFFIX(doc.id))
    const signed = new Uint8Array(doc.pdf.length + tail.length)
    signed.set(doc.pdf)
    signed.set(tail, doc.pdf.length)
    return new Response(signed, {
      headers: { 'Content-Type': 'application/pdf' },
    })
  }

  function list(url: URL): Response {
    const perPage = Math.max(1, Number(url.searchParams.get('perPage')) || 10)
    const all = [...documents.values()]
    return json(200, {
      data: all.slice(0, perPage).map(envelopeJson),
      count: all.length,
      currentPage: 1,
      perPage,
      totalPages: Math.max(1, Math.ceil(all.length / perPage)),
    })
  }

  /** The operation a request names, and the id in its path. */
  function operationOf(
    req: Request,
    path: string,
  ): [FakeDocumensoOperation, string] | null {
    if (req.method === 'POST') {
      const posts: [string, FakeDocumensoOperation][] = [
        [DOCUMENSO_PATHS.create, 'create'],
        [DOCUMENSO_PATHS.distribute, 'distribute'],
        [DOCUMENSO_PATHS.redistribute, 'redistribute'],
        [DOCUMENSO_PATHS.cancel, 'cancel'],
        [DOCUMENSO_PATHS.delete, 'delete'],
      ]
      const match = posts.find(([p]) => p === path)
      return match ? [match[1], ''] : null
    }
    if (req.method !== 'GET') return null
    if (path === DOCUMENSO_PATHS.list) return ['list', '']
    const download =
      /^\/api\/v2\/envelope\/item\/(envelope_item_[a-z]+)\/download$/
        .exec(path)
    if (download) return ['download', download[1]]
    const read = /^\/api\/v2\/envelope\/(envelope_[a-z]+)$/.exec(path)
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
      case 'distribute':
        return await distribute(req)
      case 'redistribute':
        return await redistribute(req)
      case 'cancel':
        return await cancelEnvelope(req)
      case 'delete':
        return await deleteEnvelope(req)
      case 'download':
        return download(id, url)
      case 'list':
        return list(url)
      case 'read': {
        const doc = find(id)
        return doc
          ? json(200, envelopeJson(doc))
          : failure(404, 'Envelope not found')
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

  function pending(envelopeId: string): FakeDocumensoDocument {
    const doc = documents.get(envelopeId)
    if (!doc) throw new Error(`fake-documenso: no envelope ${envelopeId}`)
    if (doc.status !== 'PENDING') {
      throw new Error(`fake-documenso: envelope ${envelopeId} is ${doc.status}`)
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
    baseUrl,
    fetch: fake as typeof fetch,
    calls,
    documents,
    failures,
    inFlight,
    open(envelopeId, recipientId) {
      const doc = pending(envelopeId)
      recipientOf(doc, recipientId, (r) => r.readStatus === 'NOT_OPENED')
        .readStatus = 'OPENED'
      doc.updatedAt = tick()
    },
    sign(envelopeId, recipientId) {
      const doc = pending(envelopeId)
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
    complete(envelopeId) {
      const doc = pending(envelopeId)
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
    reject(envelopeId, recipientId, reason = 'Je ne signe pas ce document.') {
      const doc = pending(envelopeId)
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
    webhookRequest(url, event, envelopeId) {
      const doc = documents.get(envelopeId)
      if (!doc) throw new Error(`fake-documenso: no envelope ${envelopeId}`)
      // Documenso 2.20's mapEnvelopeToWebhookDocumentPayload: the legacy id
      // first, the envelope id beside it, and recipients twice (`Recipient`
      // is the legacy copy), tokens included.
      const recipients = doc.recipients.map((r) => ({
        ...recipientJson(doc, r),
        documentId: doc.legacyId,
        templateId: null,
      }))
      return new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Documenso-Secret': webhookSecret,
        },
        body: JSON.stringify({
          event,
          payload: {
            id: doc.legacyId,
            envelopeId: doc.id,
            externalId: doc.externalId,
            title: doc.title,
            status: doc.status,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            completedAt: doc.completedAt,
            documentMeta: doc.meta,
            recipients,
            Recipient: recipients,
          },
          createdAt: tick(),
          webhookEndpoint: url,
        }),
      })
    },
  }
}
