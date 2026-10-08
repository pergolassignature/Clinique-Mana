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
 *   status (null when no complete answer arrived) and a code:
 *   `not_configured` when the key is refused (401/403) or the URL / key is
 *   missing, `invalid_request` for input refused before any request (two
 *   recipients with one address, a bad expiry), otherwise `provider_error`.
 *   A response body is never read into an error, a log or a return value:
 *   Documenso quotes addresses in its messages. Transport errors (while
 *   connecting or while reading a body) are reduced to their kind (`timed
 *   out`, `aborted`, `unreachable`): the raw error can quote the URL.
 * - **Reach (P3-34, SSRF):** the key goes only where the clinic's admin
 *   pointed it, and never inside our network. Every request is sent with
 *   `redirect: 'manual'`, and any 3xx is a `provider_error` (a redirect would
 *   carry the key elsewhere). Outside local dev (`DocumensoReach.local`), the
 *   URL must be `https://` to a name that is not `localhost`, `.localhost`,
 *   `.internal` or `.local`, and before every request its A and AAAA records
 *   are resolved: a private, loopback, link-local, CGNAT, multicast, reserved
 *   or unspecified address (IPv4, IPv6, IPv4-mapped IPv6) refuses the request
 *   (`provider_error`, status null, the address never quoted). Local dev
 *   allows the fake's `http://host.docker.internal:<port>` and checks no
 *   address. `signing_settings` refuses IP literals and the rest in the
 *   database (private.signing_base_url_valid).
 * - **Limits:** each request, body included, is cut after `timeoutMs` (20 s
 *   by default) and stops at once when the caller's `signal` aborts. A signed
 *   PDF over `maxDownloadBytes` (25 MB) is refused while it streams; a JSON
 *   body over 1 MB is refused the same way.
 * - Nothing here logs. Document ids are numeric strings (the `document` API's
 *   ids) and envelope ids `envelope_…`; anything else is refused before a
 *   request, so no id reaches a path or a body unchecked.
 *
 * The paths use the v2 `document` family, as PS Hub does, except `cancel`,
 * which uses the `envelope` family when the envelope id is known. Documenso
 * marks `document` deprecated in favour of `envelope` (string ids); every
 * path used here is in the public v2 OpenAPI document
 * (app.documenso.com/api/v2/openapi.json, checked 2026-10-08). The ones PS
 * Hub never called are marked `VERIFY` below; the fake
 * (`testing/fake-documenso.ts`, also served locally by
 * `scripts/fake-documenso.ts`) mirrors this table exactly.
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
  /** POST `{ envelopeId, reason? }`: a pending document is cancelled and stays visible. */
  // VERIFY against the clinic instance (Mise en service): in the public v2
  // OpenAPI (« Cancel a pending envelope », 200 `{ success }`, checked
  // 2026-10-08). Its answer for a draft or an already-cancelled envelope is
  // not documented: `cancel` reads the status back after a 400.
  cancel: '/api/v2/envelope/cancel',
  /** POST `{ documentId }`: a draft is deleted, a pending document cancelled (`DOCUMENT_CANCELLED`). */
  // VERIFY against the clinic instance (Mise en service): the `document`
  // family has no cancel; deleting a pending document cancels it and fires
  // DOCUMENT_CANCELLED. Used when the envelope id is unknown (and for drafts).
  delete: '/api/v2/document/delete',
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
    /**
     * Days before the invitation expires (a positive integer), sent as
     * `envelopeExpirationPeriod: { unit: 'day', amount }`; absent, the
     * instance's default applies.
     */
    expiryDays?: number
  }
}

/** What `cancel` may know besides the document id. */
export interface DocumensoCancelOptions {
  /**
   * From `createDocument`. Set, the envelope is cancelled and stays visible
   * in Documenso; absent (or null), the document is deleted, which cancels a
   * pending one too. Documenso cancels only a pending (distributed)
   * envelope: cancel a draft by its document id alone.
   */
  envelopeId?: string | null
  /** Why, as Documenso records it (envelope cancel only). */
  reason?: string
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
  /**
   * The `externalId` the document was created with (the request id, see
   * `createDocument`), or null when it has none (the field itself is
   * required: a read without it is a bad response): how the signing functions
   * tell their own document from another one under the same id (an org that
   * changed Documenso instance).
   */
  externalId: string | null
  recipients: {
    id: string
    /**
     * As sent to `createDocument` (1-based), or null when Documenso has none:
     * how the signing functions match recipients to signers (never by address).
     */
    signingOrder: number | null
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
   * recipient ids back (PS Hub's two calls). Two recipients with the same
   * address (case-insensitive) are refused first (`invalid_request`): the
   * recipient ids are read back by address, so they could not be told apart.
   * When the second step fails, the error's `documentId` names the created
   * document, so it can be cancelled. `envelopeId` is null when Documenso
   * did not return a well-formed one.
   */
  createDocument(
    pdf: Uint8Array,
    input: CreateDocumentInput,
  ): Promise<{
    documentId: string
    envelopeId: string | null
    recipients: { id: string; email: string }[]
  }>
  /** Places the fields; an empty list makes no request. */
  addFields(documentId: string, fields: DocumensoFieldInput[]): Promise<void>
  /** Sends the document (Documenso emails the first signer). */
  distribute(documentId: string): Promise<void>
  /** Resends the invitation to these recipients; an empty list makes no request. */
  redistribute(documentId: string, recipientIds: string[]): Promise<void>
  /** The document's status and recipients. */
  get(documentId: string): Promise<DocumensoDocumentState>
  /**
   * Cancels the document (`DocumensoCancelOptions`). Already done counts as
   * done: a 404 whose body is Documenso's `NOT_FOUND` error (any other 404,
   * e.g. a proxy's, is an error), or, for an envelope, a 400 while the
   * document reads back as CANCELLED.
   */
  cancel(documentId: string, options?: DocumensoCancelOptions): Promise<void>
  /** The signed PDF (Documenso appends its certificate). */
  downloadSigned(documentId: string): Promise<Uint8Array>
  /**
   * One authenticated read: ok, or the HTTP status. Throws when nothing
   * answered, or when a 2xx is not Documenso's list (`{ data: [...] }`, e.g.
   * the base URL points at another server).
   */
  ping(): Promise<{ ok: true } | { ok: false; status: number }>
}

/** `Deno.resolveDns` for one record type; tests inject a fake (P3-34). */
export type ResolveDns = (
  host: string,
  type: 'A' | 'AAAA',
  signal: AbortSignal,
) => Promise<string[]>

/** Where the client may send requests (P3-34). */
export interface DocumensoReach {
  /**
   * True only when `APP_URL` is a local http URL (`isLocalAppUrl`): the local
   * fake (`http://host.docker.internal:<port>`) is allowed and no address is
   * checked. False everywhere else.
   */
  local: boolean
  resolveDns: ResolveDns
}

/** The runtime's resolver. */
export const denoResolveDns: ResolveDns = (host, type, signal) =>
  Deno.resolveDns(host, type, { signal })

/** The default reach: not local, the runtime's resolver (fails closed). */
const DEPLOYED_REACH: DocumensoReach = {
  local: false,
  resolveDns: denoResolveDns,
}

/** Client tuning; tests shorten the timeout. */
export interface DocumensoClientOptions {
  /** Where requests may go (default: deployed, `Deno.resolveDns`). */
  reach?: DocumensoReach
  /** Per-request timeout (default 20 s). */
  timeoutMs?: number
  /** The caller's signal (e.g. `req.signal`): aborting it stops the request. */
  signal?: AbortSignal
  /** Largest signed PDF accepted (default 25 MB). */
  maxDownloadBytes?: number
}

/** The codes a Documenso failure maps to (P3-28). */
export type DocumensoErrorCode =
  | 'provider_error'
  | 'not_configured'
  | 'invalid_request'

/**
 * A Documenso failure. `status` is the HTTP status, or null when no complete
 * answer arrived (network error, timeout or abort, while connecting or
 * reading the body) or before any request. The message names the operation
 * and the status or the failure's kind only.
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
/**
 * DATE fields day first, as PS Hub sends them. Not the Québec standard
 * order, which is year first (yyyy-MM-dd, also in Documenso's list).
 */
const DATE_FORMAT = 'dd/MM/yyyy'
/** Documenso's ids in the `document` API are integers: ≤ 15 digits stay safe integers. */
const NUMERIC_ID = /^[1-9][0-9]{0,14}$/
/** Envelope ids: `envelope_` and a generated suffix. */
// VERIFY against the clinic instance (Mise en service): the suffix alphabet.
const ENVELOPE_ID = /^envelope_[A-Za-z0-9_-]{1,64}$/
const PDF_MAGIC = '%PDF-'
/** Largest JSON success body read (a document with its recipients is far smaller). */
const MAX_JSON_BYTES = 1024 * 1024
/** Largest error body read (only `cancel` reads one, for its 404). */
const MAX_ERROR_BYTES = 64 * 1024

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

/** Four octets, or null when `text` is not a dotted-quad IPv4 address. */
function parseIPv4(text: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  return octets.every((o) => o <= 255) ? octets : null
}

/** Eight 16-bit groups, or null when `text` is not an IPv6 address (brackets and zone allowed). */
function parseIPv6(text: string): number[] | null {
  let s = text.replace(/^\[(.*)\]$/, '$1').replace(/%.*$/, '').toLowerCase()
  let tail: number[] = []
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s)
  if (dotted) {
    const v4 = parseIPv4(dotted[2])
    if (!v4) return null
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    s = dotted[1].endsWith('::') ? dotted[1] : dotted[1].slice(0, -1)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const groups = (part: string) => (part === '' ? [] : part.split(':'))
  const head = groups(halves[0])
  const rest = halves.length === 2 ? groups(halves[1]) : []
  if (![...head, ...rest].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null
  const count = head.length + rest.length + tail.length
  if (halves.length === 1 ? count !== 8 : count > 7) return null
  const hex = (part: string[]) => part.map((g) => parseInt(g, 16))
  return [
    ...hex(head),
    ...new Array(halves.length === 2 ? 8 - count : 0).fill(0),
    ...hex(rest),
    ...tail,
  ]
}

/**
 * Not unspecified (0/8), private (10/8, 172.16/12, 192.168/16), CGNAT
 * (100.64/10), loopback (127/8), link-local (169.254/16), IETF protocol
 * (192.0.0/24), benchmarking (198.18/15), multicast (224/4) or reserved
 * and broadcast (240/4).
 */
function publicIPv4([a, b, c]: number[]): boolean {
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

/**
 * Global unicast (2000::/3) only, so not unspecified, loopback, unique local
 * (fc00::/7), link-local (fe80::/10), site-local or multicast (ff00::/8). An
 * address that carries an IPv4 one (IPv4-mapped ::ffff:0:0/96,
 * IPv4-compatible ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16) is judged by
 * that IPv4 address. Documentation (2001:db8::/32) and Teredo (2001::/32,
 * whose IPv4 is obfuscated) are refused.
 */
function publicIPv6(h: number[]): boolean {
  const v4At = (
    i: number,
  ) => [h[i] >> 8, h[i] & 255, h[i + 1] >> 8, h[i + 1] & 255]
  const zeros = (from: number, to: number) =>
    h.slice(from, to).every((g) => g === 0)
  if (zeros(0, 5) && (h[5] === 0 || h[5] === 0xffff)) return publicIPv4(v4At(6))
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) {
    return publicIPv4(v4At(6))
  }
  if (h[0] === 0x2002) return publicIPv4(v4At(1))
  if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0xdb8)) return false
  return (h[0] & 0xe000) === 0x2000
}

/** True for a public unicast IPv4 or IPv6 address; false for anything else (P3-34). */
export function isPublicAddress(text: string): boolean {
  const v4 = parseIPv4(text)
  if (v4) return publicIPv4(v4)
  const v6 = parseIPv6(text)
  return v6 !== null && publicIPv6(v6)
}

/** Names that never leave the machine or the private network. */
const PRIVATE_NAME = /(^localhost|\.localhost|\.internal|\.local)\.?$/

/**
 * Whether a request to `url` may go out (P3-34, module comment): true in
 * local dev; otherwise `https:`, a public name, and every A and AAAA record
 * public. Throws when nothing resolves (or on abort): the caller reports the
 * failure's kind.
 *
 * DNS rebinding: `fetch` resolves the name again on its own, so a name with a
 * zero TTL can answer a public address here and a private one to `fetch`.
 * Deno's fetch cannot be pinned to the address checked here (no resolver
 * hook; TLS needs the name). What is left of that window is narrow: the URL
 * is https only and no redirect is followed, so an internal service would
 * also have to present a valid certificate for the attacker's name before the
 * key is sent; the database refuses IP literals and private names first.
 */
async function reachable(
  url: URL,
  reach: DocumensoReach,
  signal: AbortSignal,
): Promise<boolean> {
  if (reach.local) return true
  const host = url.hostname
  if (url.protocol !== 'https:') return false
  if (host.startsWith('[') || parseIPv4(host)) return isPublicAddress(host)
  if (!host.includes('.') || PRIVATE_NAME.test(host)) return false
  const answers = await Promise.allSettled([
    reach.resolveDns(host, 'A', signal),
    reach.resolveDns(host, 'AAAA', signal),
  ])
  signal.throwIfAborted()
  const addresses = answers.flatMap((a) =>
    a.status === 'fulfilled' ? a.value : []
  )
  if (addresses.length === 0) throw new Error('unresolved')
  return addresses.every(isPublicAddress)
}

const createdSchema = z.object({
  id: z.number().int().positive(),
  envelopeId: z.unknown().optional(),
})

/** `{ data: [...] }`, the list `ping` reads. */
const listSchema = z.object({ data: z.array(z.unknown()) })

/** Documenso's error body for a missing document or envelope. */
// VERIFY against the clinic instance (Mise en service): `code` is the tRPC
// error code (OpenAPI error shape `{ message, code, issues? }`).
const notFoundSchema = z.object({
  message: z.string(),
  code: z.literal('NOT_FOUND'),
})

const nullableString = z.string().nullish().transform((v) => v ?? null)

const documentSchema = z.object({
  status: z.enum(['DRAFT', 'PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED']),
  completedAt: nullableString,
  // The v2 OpenAPI's document read: `externalId`, a string or null, always
  // present (checked 2026-10-08); the create payload's `externalId` is a
  // string of at most 255. Required here: a read without the field is a bad
  // response (`provider_error`), never a document « held under no id », so a
  // re-send stops on `previous_read_failed` (retryable) instead of taking the
  // document for another's.
  // VERIFY against the clinic instance (Mise en service): the read carries
  // `externalId`.
  externalId: z.string().nullable(),
  recipients: z.array(z.object({
    id: z.number().int().positive(),
    email: z.string(),
    signingOrder: z.number().int().nullish().transform((v) => v ?? null),
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

/** A response, and the error its transport failure maps to. */
interface Exchange {
  operation: Operation
  res: Response
  /** The failure (kind only, never the raw error); `reading` once the body started. */
  failure(reading?: boolean): DocumensoError
}

/** Drops the body; a stream that already failed has nothing left to drop. */
async function discard(exchange: Exchange): Promise<void> {
  try {
    await exchange.res.body?.cancel()
  } catch {
    // Nothing to keep: the status is all the caller uses.
  }
}

/**
 * The body bytes, or null past `maxBytes` (reading stops there). A
 * transport failure mid-body (timeout, abort, dropped connection) throws the
 * exchange's failure, never the raw error.
 */
async function readCapped(
  exchange: Exchange,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const { res } = exchange
  if (Number(res.headers.get('Content-Length')) > maxBytes) {
    await discard(exchange)
    return null
  }
  if (!res.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    throw exchange.failure(true)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** The body as JSON, or undefined when it is not JSON (read errors throw). */
async function readJson(
  exchange: Exchange,
  maxBytes: number,
): Promise<unknown> {
  const bytes = await readCapped(exchange, maxBytes)
  if (bytes === null) return undefined
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

/**
 * A Documenso client for one instance. Throws `DocumensoError`
 * (`not_configured`) when `apiKey` is empty or `baseUrl` is not an http(s)
 * URL. Where requests may go (`options.reach`, P3-34) is checked before each
 * one: a refusal is a `provider_error` (module comment).
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
  const reach = options.reach ?? DEPLOYED_REACH
  const target = new URL(base)

  /** One request; the response is returned whatever its status. */
  async function send(
    operation: Operation,
    path: string,
    init: { method: 'GET' | 'POST'; json?: unknown; body?: FormData },
  ): Promise<Exchange> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal
      ? AbortSignal.any([timeout, options.signal])
      : timeout
    // The raw error can quote the URL: only its kind is kept.
    const failure = (reading = false) => {
      const reason = options.signal?.aborted
        ? 'aborted'
        : timeout.aborted
        ? 'timed out'
        : 'unreachable'
      return new DocumensoError(
        'provider_error',
        null,
        `Documenso ${operation} ${reason}${
          reading ? ' while reading the response' : ''
        }`,
      )
    }
    let allowed: boolean
    try {
      allowed = await reachable(target, reach, signal)
    } catch {
      throw failure()
    }
    if (!allowed) {
      throw new DocumensoError(
        'provider_error',
        null,
        `Documenso ${operation} refused: not a public address`,
      )
    }
    const headers: Record<string, string> = { Authorization: apiKey }
    if (init.json !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetchFn(`${base}${path}`, {
        method: init.method,
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
        // Never followed: a redirect would carry the key to another host.
        redirect: 'manual',
        signal,
      })
    } catch {
      throw failure()
    }
    if (
      res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)
    ) {
      await res.body?.cancel().catch(() => {})
      throw new DocumensoError(
        'provider_error',
        res.status || null,
        `Documenso ${operation} redirected (not followed)`,
      )
    }
    return { operation, res, failure }
  }

  /** A request that must succeed; the body is left to the caller. */
  async function ok(
    operation: Operation,
    path: string,
    init: Parameters<typeof send>[2],
  ): Promise<Exchange> {
    const exchange = await send(operation, path, init)
    if (!exchange.res.ok) {
      await discard(exchange)
      throw statusError(operation, exchange.res.status)
    }
    return exchange
  }

  /** A request that must succeed, its body discarded. */
  async function done(
    operation: Operation,
    path: string,
    init: Parameters<typeof send>[2],
  ): Promise<void> {
    await discard(await ok(operation, path, init))
  }

  /** A successful JSON body (≤ 1 MB) parsed with `schema`. */
  async function parsed<S extends z.ZodType>(
    exchange: Exchange,
    schema: S,
  ): Promise<z.output<S>> {
    const { operation, res } = exchange
    const result = schema.safeParse(await readJson(exchange, MAX_JSON_BYTES))
    if (!result.success) throw badResponse(operation, res.status)
    return result.data
  }

  async function readDocument(documentId: string) {
    const id = numericId(documentId, 'read')
    const exchange = await ok('read', DOCUMENSO_PATHS.document(String(id)), {
      method: 'GET',
    })
    return parsed(exchange, documentSchema)
  }

  /** Refuses input Documenso would accept wrongly (`invalid_request`). */
  function checkInput(input: CreateDocumentInput): void {
    const refuse = (why: string) => {
      throw new DocumensoError(
        'invalid_request',
        null,
        `Documenso create: ${why}`,
      )
    }
    const emails = input.recipients.map((r) => r.email.trim().toLowerCase())
    if (new Set(emails).size !== emails.length) {
      refuse('two recipients share an address')
    }
    const days = input.meta.expiryDays
    if (days !== undefined && !(Number.isSafeInteger(days) && days >= 1)) {
      refuse('expiryDays is not a positive integer')
    }
  }

  return {
    async createDocument(pdf, input) {
      checkInput(input)
      const { expiryDays, ...meta } = input.meta
      const form = new FormData()
      form.append(
        'payload',
        JSON.stringify({
          title: input.title,
          externalId: input.externalId,
          recipients: input.recipients,
          meta: {
            ...meta,
            dateFormat: DATE_FORMAT,
            ...(expiryDays === undefined ? {} : {
              envelopeExpirationPeriod: { unit: 'day', amount: expiryDays },
            }),
          },
        }),
      )
      // A fixed file name: the title can name a person (Loi 25).
      form.append(
        'file',
        new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        'document.pdf',
      )
      const created = await parsed(
        await ok('create', DOCUMENSO_PATHS.create, {
          method: 'POST',
          body: form,
        }),
        createdSchema,
      )
      const documentId = String(created.id)
      const envelopeId = typeof created.envelopeId === 'string' &&
          ENVELOPE_ID.test(created.envelopeId)
        ? created.envelopeId
        : null
      try {
        const doc = await readDocument(documentId)
        const recipients = input.recipients.map(({ email }) => {
          const match = doc.recipients.find((r) =>
            r.email.toLowerCase() === email.toLowerCase()
          )
          if (!match) throw badResponse('read', 200)
          return { id: String(match.id), email }
        })
        return { documentId, envelopeId, recipients }
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
        externalId: doc.externalId,
        recipients: doc.recipients.map((r) => ({
          id: String(r.id),
          signingOrder: r.signingOrder,
          signingStatus: r.signingStatus,
          readStatus: r.readStatus,
          signedAt: r.signedAt,
          rejectionReason: r.rejectionReason,
        })),
      }
    },

    async cancel(documentId, { envelopeId = null, reason } = {}) {
      const id = numericId(documentId, 'cancel')
      if (envelopeId !== null && !ENVELOPE_ID.test(envelopeId)) {
        throw new DocumensoError(
          'provider_error',
          null,
          'Documenso cancel: invalid id',
        )
      }
      const exchange = envelopeId !== null
        ? await send('cancel', DOCUMENSO_PATHS.cancel, {
          method: 'POST',
          json: { envelopeId, ...(reason === undefined ? {} : { reason }) },
        })
        : await send('cancel', DOCUMENSO_PATHS.delete, {
          method: 'POST',
          json: { documentId: id },
        })
      const { status } = exchange.res
      if (exchange.res.ok) return await discard(exchange)
      if (status === 404) {
        // Gone already, but only Documenso's own error says so: a proxy's or
        // another server's 404 (a wrong base URL) is an error.
        const body = await readJson(exchange, MAX_ERROR_BYTES)
        if (notFoundSchema.safeParse(body).success) return
        throw statusError('cancel', status)
      }
      await discard(exchange)
      if (envelopeId !== null && status === 400) {
        // Documenso refuses to cancel what is not pending: already cancelled
        // counts as done, anything else (a draft, a completed document) not.
        try {
          if ((await readDocument(documentId)).status === 'CANCELLED') return
        } catch {
          // The cancel's own error is the one to report.
        }
      }
      throw statusError('cancel', status)
    },

    async downloadSigned(documentId) {
      const id = numericId(documentId, 'download')
      const exchange = await ok(
        'download',
        `${DOCUMENSO_PATHS.download(String(id))}?version=signed`,
        { method: 'GET' },
      )
      const bytes = await readCapped(exchange, maxDownloadBytes)
      if (
        bytes === null ||
        new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) !==
          PDF_MAGIC
      ) {
        throw badResponse('download', exchange.res.status)
      }
      return bytes
    },

    async ping() {
      const exchange = await send('ping', `${DOCUMENSO_PATHS.list}?perPage=1`, {
        method: 'GET',
      })
      if (!exchange.res.ok) {
        await discard(exchange)
        return { ok: false, status: exchange.res.status }
      }
      await parsed(exchange, listSchema)
      return { ok: true }
    },
  }
}
