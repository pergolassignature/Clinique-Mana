/**
 * Documenso v2 client (design §6.1, Task 3.32), ported from PS Hub
 * `approve-contract` (create, read recipients, distribute),
 * `resend-contract-email` (redistribute) and `documenso-webhook`
 * (`documensoEventId`, signed-PDF download).
 *
 * - **Configuration:** the base URL comes from `signing_settings.base_url` and
 *   the key from Vault (`documenso_api_key`); neither is ever a constant (PS
 *   Hub hard-codes its URL). Requests send `Authorization: <key>`, no
 *   `Bearer`, as Documenso's `apiKey` scheme expects.
 * - **Errors:** every failure throws a `DocumensoError` carrying the HTTP
 *   status (null when there was no answer) and a code: `not_configured` when
 *   the key is refused (401/403) or the URL / key is missing, otherwise
 *   `provider_error`. A response body is never read into an error, a log or a
 *   return value: Documenso quotes addresses in its messages.
 * - **Limits:** each request is cut after `timeoutMs` (20 s by default) and
 *   stops at once when the caller's `signal` aborts. A signed PDF over
 *   `maxDownloadBytes` (25 MB) is refused while it streams.
 * - Nothing here logs. Ids are numeric strings (the `document` API's ids);
 *   anything else is refused before a request, so no id reaches a path
 *   unchecked.
 *
 * The paths use the v2 `document` family, as PS Hub does. Documenso marks it
 * deprecated in favour of `envelope` (string ids); every path used here is
 * still in the public v2 OpenAPI document (checked 2026-10-08). The ones PS
 * Hub never called are marked `VERIFY` below; the fake servers
 * (`scripts/fake-documenso.mjs`, `testing/fake-documenso.ts`) mirror this
 * table exactly.
 */
import { z } from 'zod'
import { FunctionError } from './errors.ts'

/** Every Documenso path this client calls, relative to the instance's base URL. */
export const DOCUMENSO_PATHS = {
  /** POST multipart: `payload` (JSON) + `file` (PDF) → `{ id, envelopeId }`. */
  create: '/api/v2/document/create',
  /** GET → the document with `status` and `recipients`. */
  document: (id: string) => `/api/v2/document/${id}`,
  /** POST `{ documentId, fields: [...] }`. */
  // VERIFY against the clinic instance (Mise en service): body shape
  // `{ documentId, fields: [{ recipientId, type, pageNumber, pageX, pageY,
  // width, height }] }` from the public OpenAPI (envelope successor:
  // /api/v2/envelope/field/create-many).
  fields: '/api/v2/document/field/create-many',
  /** POST `{ documentId }`: sends the signing emails. */
  distribute: '/api/v2/document/distribute',
  /** POST `{ documentId, recipients: number[] }`: resends to those recipients. */
  redistribute: '/api/v2/document/redistribute',
  /** POST `{ documentId }`: a pending document is cancelled (`DOCUMENT_CANCELLED`). */
  // VERIFY against the clinic instance (Mise en service): the `document`
  // family has no cancel; deleting a pending document cancels it and fires
  // DOCUMENT_CANCELLED. Newer instances also have POST /api/v2/envelope/cancel
  // `{ envelopeId }`, which keeps the document visible.
  cancel: '/api/v2/document/delete',
  /** GET `?version=signed` → the signed PDF (certificate appended). */
  // VERIFY against the clinic instance (Mise en service): raw PDF bytes, as PS
  // Hub reads them (envelope successor: /api/v2/envelope/item/{itemId}/download).
  download: (id: string) => `/api/v2/document/${id}/download`,
  /** GET `?perPage=1`: the cheapest authenticated read (`ping`). */
  list: '/api/v2/document',
} as const

/** Documenso's document statuses. */
export type DocumensoDocumentStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'

/** One recipient to create; `signingOrder` starts at 1. */
export interface DocumensoRecipientInput {
  email: string
  name: string
  role: 'SIGNER'
  signingOrder: number
}

/** What `createDocument` needs besides the PDF. */
export interface CreateDocumentInput {
  title: string
  /** Our `signature_requests.id`; Documenso echoes it in webhooks. */
  externalId: string
  recipients: DocumensoRecipientInput[]
  meta: {
    /** The invitation email's subject and text (from the template version). */
    subject: string
    message: string
    language: 'fr'
    distributionMethod: 'EMAIL'
    signingOrder: 'SEQUENTIAL' | 'PARALLEL'
    /** The clinic timezone (`organizations.timezone`), for DATE fields. */
    timezone: string
  }
}

/**
 * One field to place, in percent of the page (origin top-left), on a
 * recipient returned by `createDocument`. A `SigningField` from
 * `_shared/pdf` plus its `recipientId` fits as is (`role` is ignored).
 */
export interface DocumensoFieldInput {
  recipientId: string
  /** The signer role from the renderer; not sent. */
  role?: string
  type: 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME'
  /** 1-based. */
  page: number
  x: number
  y: number
  width: number
  height: number
}

/** A document's state, as `get` returns it: no address or name. */
export interface DocumensoDocumentState {
  status: DocumensoDocumentStatus
  completedAt: string | null
  recipients: {
    id: string
    /** `NOT_SIGNED` | `SIGNED` | `REJECTED` today. */
    signingStatus: string
    /** `NOT_OPENED` | `OPENED` today. */
    readStatus: string
    signedAt: string | null
    rejectionReason: string | null
  }[]
}

/** The calls the signing functions make. Every method throws `DocumensoError`. */
export interface DocumensoClient {
  /**
   * Uploads the PDF with its recipients and meta (as a draft), then reads the
   * recipient ids back (PS Hub's two calls). When the second step fails, the
   * error's `documentId` names the created document, so it can be cancelled.
   */
  createDocument(
    pdf: Uint8Array,
    input: CreateDocumentInput,
  ): Promise<
    { documentId: string; recipients: { id: string; email: string }[] }
  >
  /** Places the fields; an empty list makes no request. */
  addFields(documentId: string, fields: DocumensoFieldInput[]): Promise<void>
  /** Sends the document (Documenso emails the first signer). */
  distribute(documentId: string): Promise<void>
  /** Resends the invitation to these recipients; an empty list makes no request. */
  redistribute(documentId: string, recipientIds: string[]): Promise<void>
  /** The document's status and recipients. */
  get(documentId: string): Promise<DocumensoDocumentState>
  /** Cancels the document; one already gone (404) counts as cancelled. */
  cancel(documentId: string): Promise<void>
  /** The signed PDF (Documenso appends its certificate). */
  downloadSigned(documentId: string): Promise<Uint8Array>
  /** One authenticated read: ok, or the HTTP status. Throws only when nothing answered. */
  ping(): Promise<{ ok: true } | { ok: false; status: number }>
}

/** Client tuning; tests shorten the timeout. */
export interface DocumensoClientOptions {
  /** Per-request timeout (default 20 s). */
  timeoutMs?: number
  /** The caller's signal (e.g. `req.signal`): aborting it stops the request. */
  signal?: AbortSignal
  /** Largest signed PDF accepted (default 25 MB). */
  maxDownloadBytes?: number
}

/** The codes a Documenso failure maps to (P3-28). */
export type DocumensoErrorCode = 'provider_error' | 'not_configured'

/**
 * A Documenso failure. `status` is the HTTP status, or null when nothing
 * answered (network error, timeout, abort) or before any request. The message
 * names the operation and the status only.
 */
export class DocumensoError extends FunctionError {
  declare readonly code: DocumensoErrorCode
  constructor(
    code: DocumensoErrorCode,
    readonly status: number | null,
    message: string,
    /** Set by `createDocument` when the document exists but a later step failed. */
    readonly documentId: string | null = null,
  ) {
    super(code, message)
    this.name = 'DocumensoError'
  }
}

const TIMEOUT_MS = 20_000
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
/** DATE fields in the Québec order (PS Hub's choice). */
const DATE_FORMAT = 'dd/MM/yyyy'
/** Documenso's ids in the `document` API are integers. */
const NUMERIC_ID = /^[1-9][0-9]{0,15}$/
const PDF_MAGIC = '%PDF-'

const TERMINAL_EVENTS = new Set([
  'DOCUMENT_COMPLETED',
  'DOCUMENT_REJECTED',
  'DOCUMENT_CANCELLED',
])

/**
 * The webhook claim id (design §2.7, PS Hub `idempotency.ts`). `event` is
 * Documenso's name (`DOCUMENT_COMPLETED`). A terminal event happens once per
 * document, so its id has no version: a replay with a new envelope timestamp
 * stays a duplicate. Other events add the version (the webhook's `createdAt`,
 * else the document's `updatedAt`), or `unversioned`.
 */
export function documensoEventId(
  event: string,
  documentId: string,
  version: string | null,
): string {
  const prefix = `${event}:${documentId}`
  return TERMINAL_EVENTS.has(event)
    ? prefix
    : `${prefix}:${version ?? 'unversioned'}`
}

const createdSchema = z.object({ id: z.number().int().positive() })

const nullableString = z.string().nullish().transform((v) => v ?? null)

const documentSchema = z.object({
  status: z.enum(['DRAFT', 'PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED']),
  completedAt: nullableString,
  recipients: z.array(z.object({
    id: z.number().int().positive(),
    email: z.string(),
    signingStatus: z.string(),
    readStatus: z.string(),
    signedAt: nullableString,
    rejectionReason: nullableString,
  })),
})

type Operation =
  | 'create'
  | 'read'
  | 'fields'
  | 'distribute'
  | 'redistribute'
  | 'cancel'
  | 'download'
  | 'ping'

function statusError(operation: Operation, status: number): DocumensoError {
  return new DocumensoError(
    status === 401 || status === 403 ? 'not_configured' : 'provider_error',
    status,
    `Documenso ${operation} failed (${status})`,
  )
}

function badResponse(operation: Operation, status: number): DocumensoError {
  return new DocumensoError(
    'provider_error',
    status,
    `Documenso ${operation}: unexpected response`,
  )
}

/** The id as a JSON number, after checking its form. */
function numericId(id: string, operation: Operation): number {
  if (!NUMERIC_ID.test(id)) {
    throw new DocumensoError(
      'provider_error',
      null,
      `Documenso ${operation}: invalid id`,
    )
  }
  return Number(id)
}

/** The body bytes, or null past `maxBytes` (reading stops there). */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (Number(res.headers.get('Content-Length')) > maxBytes) {
    await res.body?.cancel()
    return null
  }
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/**
 * A Documenso client for one instance. Throws `DocumensoError`
 * (`not_configured`) when `apiKey` is empty or `baseUrl` is not an http(s)
 * URL; the `https://` rule for real instances is enforced by
 * `signing_settings` (P3-30).
 */
export function documensoClient(
  baseUrl: string,
  apiKey: string,
  fetchFn: typeof fetch,
  options: DocumensoClientOptions = {},
): DocumensoClient {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (
    !apiKey || !URL.canParse(base) ||
    !['http:', 'https:'].includes(new URL(base).protocol)
  ) {
    throw new DocumensoError(
      'not_configured',
      null,
      'Documenso is not configured',
    )
  }
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const maxDownloadBytes = options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES

  /** One request; the response is returned whatever its status. */
  async function send(
    operation: Operation,
    path: string,
    init: { method: 'GET' | 'POST'; json?: unknown; body?: FormData },
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal
      ? AbortSignal.any([timeout, options.signal])
      : timeout
    const headers: Record<string, string> = { Authorization: apiKey }
    if (init.json !== undefined) headers['Content-Type'] = 'application/json'
    try {
      return await fetchFn(`${base}${path}`, {
        method: init.method,
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
        signal,
      })
    } catch {
      // The error can quote the URL: only its kind is kept.
      const reason = options.signal?.aborted
        ? 'aborted'
        : timeout.aborted
        ? 'timed out'
        : 'unreachable'
      throw new DocumensoError(
        'provider_error',
        null,
        `Documenso ${operation} ${reason}`,
      )
    }
  }

  /** A request that must succeed; the body is left to the caller. */
  async function ok(
    operation: Operation,
    path: string,
    init: Parameters<typeof send>[2],
  ): Promise<Response> {
    const res = await send(operation, path, init)
    if (!res.ok) {
      await res.body?.cancel()
      throw statusError(operation, res.status)
    }
    return res
  }

  /** A request that must succeed, its body discarded. */
  async function done(
    operation: Operation,
    path: string,
    init: Parameters<typeof send>[2],
  ): Promise<void> {
    const res = await ok(operation, path, init)
    await res.body?.cancel()
  }

  /** A successful JSON body parsed with `schema`. */
  async function parsed<S extends z.ZodType>(
    operation: Operation,
    res: Response,
    schema: S,
  ): Promise<z.output<S>> {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw badResponse(operation, res.status)
    }
    const result = schema.safeParse(body)
    if (!result.success) throw badResponse(operation, res.status)
    return result.data
  }

  async function readDocument(documentId: string) {
    const id = numericId(documentId, 'read')
    const res = await ok('read', DOCUMENSO_PATHS.document(String(id)), {
      method: 'GET',
    })
    return parsed('read', res, documentSchema)
  }

  return {
    async createDocument(pdf, input) {
      const form = new FormData()
      form.append(
        'payload',
        JSON.stringify({
          title: input.title,
          externalId: input.externalId,
          recipients: input.recipients,
          meta: { ...input.meta, dateFormat: DATE_FORMAT },
        }),
      )
      // A fixed file name: the title can name a person (Loi 25).
      form.append(
        'file',
        new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        'document.pdf',
      )
      const res = await ok('create', DOCUMENSO_PATHS.create, {
        method: 'POST',
        body: form,
      })
      const documentId = String((await parsed('create', res, createdSchema)).id)
      try {
        const doc = await readDocument(documentId)
        const recipients = input.recipients.map(({ email }) => {
          const match = doc.recipients.find((r) =>
            r.email.toLowerCase() === email.toLowerCase()
          )
          if (!match) throw badResponse('read', 200)
          return { id: String(match.id), email }
        })
        return { documentId, recipients }
      } catch (error) {
        const e = error instanceof DocumensoError
          ? error
          : badResponse('read', 200)
        throw new DocumensoError(e.code, e.status, e.message, documentId)
      }
    },

    async addFields(documentId, fields) {
      if (fields.length === 0) return
      await done('fields', DOCUMENSO_PATHS.fields, {
        method: 'POST',
        json: {
          documentId: numericId(documentId, 'fields'),
          fields: fields.map((f) => ({
            recipientId: numericId(f.recipientId, 'fields'),
            type: f.type,
            pageNumber: f.page,
            pageX: f.x,
            pageY: f.y,
            width: f.width,
            height: f.height,
          })),
        },
      })
    },

    async distribute(documentId) {
      await done('distribute', DOCUMENSO_PATHS.distribute, {
        method: 'POST',
        json: { documentId: numericId(documentId, 'distribute') },
      })
    },

    async redistribute(documentId, recipientIds) {
      if (recipientIds.length === 0) return
      await done('redistribute', DOCUMENSO_PATHS.redistribute, {
        method: 'POST',
        json: {
          documentId: numericId(documentId, 'redistribute'),
          recipients: recipientIds.map((id) => numericId(id, 'redistribute')),
        },
      })
    },

    async get(documentId) {
      const doc = await readDocument(documentId)
      return {
        status: doc.status,
        completedAt: doc.completedAt,
        recipients: doc.recipients.map((r) => ({
          id: String(r.id),
          signingStatus: r.signingStatus,
          readStatus: r.readStatus,
          signedAt: r.signedAt,
          rejectionReason: r.rejectionReason,
        })),
      }
    },

    async cancel(documentId) {
      const res = await send('cancel', DOCUMENSO_PATHS.cancel, {
        method: 'POST',
        json: { documentId: numericId(documentId, 'cancel') },
      })
      await res.body?.cancel()
      if (!res.ok && res.status !== 404) throw statusError('cancel', res.status)
    },

    async downloadSigned(documentId) {
      const id = numericId(documentId, 'download')
      const res = await ok(
        'download',
        `${DOCUMENSO_PATHS.download(String(id))}?version=signed`,
        { method: 'GET' },
      )
      const bytes = await readCapped(res, maxDownloadBytes)
      if (
        bytes === null ||
        new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) !==
          PDF_MAGIC
      ) {
        throw badResponse('download', res.status)
      }
      return bytes
    },

    async ping() {
      const res = await send('ping', `${DOCUMENSO_PATHS.list}?perPage=1`, {
        method: 'GET',
      })
      await res.body?.cancel()
      return res.ok ? { ok: true } : { ok: false, status: res.status }
    },
  }
}
