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
 * - Nothing here logs. Envelope ids are `envelope_…` (`ENVELOPE_ID`), item
 *   ids are checked path-safe (`ITEM_ID`) and recipient ids are numeric; any
 *   other id is refused before a request, so no id reaches a path or a body
 *   unchecked.
 *
 * The paths are the v2 `envelope` family only (plan
 * docs/plans/2026-10-08-documenso-envelope-api-plan.md): the clinic's
 * Documenso 2.20 marks every `/api/v2/document/*` route deprecated. Every path
 * is in the instance's OpenAPI document (`/api/v2/openapi.json`, 2.20.0,
 * checked 2026-10-08). What it leaves open is marked `VERIFY` below and listed
 * in §4 of the plan (live checks); the fake (`testing/fake-documenso.ts`, also
 * served locally by `scripts/fake-documenso.ts`) mirrors this table exactly.
 */
import { z } from 'zod'
import { FunctionError } from './errors.ts'

/** Every Documenso path this client calls, relative to the instance's base URL. */
export const DOCUMENSO_PATHS = {
  /**
   * POST multipart: `payload` (JSON: recipients with their fields inline,
   * E-5) + `files` (the one PDF) → `{ id }`, the envelope id.
   */
  // VERIFY against the clinic instance (plan §4.2 item 2): an inline field's
  // `identifier` is the file's index in `files` (0 here), as Documenso's own
  // embed client sends it.
  create: '/api/v2/envelope/create',
  /** GET → the envelope: `status`, `externalId`, `recipients`, `envelopeItems`. */
  envelope: (id: string) => `/api/v2/envelope/${id}`,
  /** POST `{ envelopeId }`: sends the signing emails. */
  distribute: '/api/v2/envelope/distribute',
  /**
   * POST `{ envelopeId, recipients: number[] }`: resends to those recipients
   * (and renews their expired signing links).
   */
  redistribute: '/api/v2/envelope/redistribute',
  /** POST `{ envelopeId, reason? }`: a pending envelope is cancelled and stays visible. */
  // VERIFY against the clinic instance (plan §4.2 items 4 and 6, R1): the
  // OpenAPI documents « Cancel a pending envelope » only; its answer for a
  // draft or an already-cancelled envelope is not documented, so `cancel`
  // reads the status back after a 400 (E-8).
  cancel: '/api/v2/envelope/cancel',
  /** POST `{ envelopeId }`: deletes an envelope. Only ever sent for a draft (E-8). */
  delete: '/api/v2/envelope/delete',
  /**
   * GET `?version=signed` → the item's signed PDF, with the signing
   * certificate and the audit log the org appends (E-7).
   */
  // VERIFY against the clinic instance (plan §4.3 items 9 and 11): the OpenAPI
  // declares `application/json` for this 200, but `signed` « returns the
  // completed document »; the client checks the bytes (`%PDF-`), not the type.
  download: (itemId: string) => `/api/v2/envelope/item/${itemId}/download`,
  /** GET `?perPage=1`: the cheapest authenticated read (`ping`, E-9). */
  list: '/api/v2/envelope',
} as const

/** Documenso's envelope statuses. */
export type DocumensoEnvelopeStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'

/**
 * One field to place, in percent of the page (origin top-left), on the
 * recipient it is listed under (E-5). A `SigningField` from `_shared/pdf`
 * fits as is (`role` is not sent).
 */
export interface DocumensoFieldInput {
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

/** One recipient to create, with its fields; `signingOrder` starts at 1. */
export interface DocumensoRecipientInput {
  email: string
  name: string
  role: 'SIGNER'
  signingOrder: number
  fields: DocumensoFieldInput[]
}

/** What `createEnvelope` needs besides the PDF. */
export interface CreateEnvelopeInput {
  title: string
  /** Our `signature_requests.id`; Documenso echoes it in webhooks. */
  externalId: string
  recipients: DocumensoRecipientInput[]
  meta: {
    /** The invitation email's subject (≤ 254) and text (≤ 5000), from the template version. */
    subject: string
    message: string
    language: 'fr'
    distributionMethod: 'EMAIL'
    signingOrder: 'SEQUENTIAL' | 'PARALLEL'
    /** The clinic timezone (`organizations.timezone`), for DATE fields. */
    timezone: string
    /**
     * Days before the signing links expire (a positive integer), sent as
     * `envelopeExpirationPeriod: { unit: 'day', amount }`; absent, the
     * instance's default applies. Documenso expires the recipients' links,
     * not the envelope (E-6).
     */
    expiryDays?: number
  }
}

/** How `cancel` closes an envelope (E-8). */
export interface DocumensoCancelOptions {
  /** Why, as Documenso records it (the cancel route only). */
  reason?: string
  /**
   * The caller read the envelope as DRAFT, or never called `distribute` on
   * it: it is deleted straight away (Documenso cancels only a pending one).
   */
  draft?: boolean
}

/** An envelope's state, as `get` returns it: no address, name, token or item. */
export interface DocumensoEnvelopeState {
  status: DocumensoEnvelopeStatus
  completedAt: string | null
  /**
   * The `externalId` the envelope was created with (the request id, see
   * `createEnvelope`), or null when it has none (the field itself is
   * required: a read without it is a bad response): how the signing functions
   * tell their own envelope from another one under the same id (an org that
   * changed Documenso instance).
   */
  externalId: string | null
  recipients: {
    id: string
    /**
     * As sent to `createEnvelope` (1-based), or null when Documenso has none:
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
   * Uploads the PDF with its recipients, their fields and the meta (as a
   * draft, one call), then reads the recipient ids back by address. Two
   * recipients with the same address (case-insensitive), or a subject or
   * message over Documenso's limits, are refused first (`invalid_request`).
   * When the read fails, the error's `envelopeId` names the created envelope,
   * so it can be cancelled; a create answer without a well-formed envelope id
   * is a bad response with none (nothing to address).
   */
  createEnvelope(
    pdf: Uint8Array,
    input: CreateEnvelopeInput,
  ): Promise<{
    envelopeId: string
    recipients: { id: string; email: string }[]
  }>
  /** Sends the envelope (Documenso emails the first signer). */
  distribute(envelopeId: string): Promise<void>
  /** Resends the invitation to these recipients; an empty list makes no request. */
  redistribute(envelopeId: string, recipientIds: string[]): Promise<void>
  /** The envelope's status and recipients. */
  get(envelopeId: string): Promise<DocumensoEnvelopeState>
  /**
   * Closes the envelope (E-8): a draft is deleted, a pending one cancelled.
   * Without `draft`, the cancel route first; on its 400 the envelope is read
   * back: CANCELLED is done, DRAFT is deleted, anything else is the cancel's
   * error. Already gone counts as done: a 404 whose body is Documenso's
   * `NOT_FOUND` error (any other 404, e.g. a proxy's, is an error).
   */
  cancel(envelopeId: string, options?: DocumensoCancelOptions): Promise<void>
  /**
   * The signed PDF of the envelope's one item (its certificate and audit log
   * appended by Documenso). Reads the envelope for the item id first.
   */
  downloadSigned(envelopeId: string): Promise<Uint8Array>
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
    /** Set by `createEnvelope` when the envelope exists but a later step failed. */
    readonly envelopeId: string | null = null,
    /**
     * True only for a 404 whose body is Documenso's own `NOT_FOUND` error
     * (`notFoundSchema`): the instance answered and the envelope is not there.
     * A proxy's or another server's 404 is false, as is every other failure
     * (E-14: callers tell an outage from a missing envelope).
     */
    readonly notFound: boolean = false,
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
/** Recipient ids are integers (E-10): ≤ 15 digits stay safe integers. */
const NUMERIC_ID = /^[1-9][0-9]{0,14}$/
/**
 * Envelope ids: `envelope_` and a generated suffix, 16 letters of
 * `abcdefhiklmnorstuvwxyz` on 2.20 (seen live: `envelope_hsnzzscbexaddcar`).
 * Deliberately looser (E-1), and the same regex as the
 * `signature_requests.envelope_id` check (a test reads the migration).
 */
export const ENVELOPE_ID = /^envelope_[A-Za-z0-9_-]{1,64}$/
/** Envelope item ids, before they go into a path (E-7, R10: format not pinned). */
// VERIFY against the clinic instance (plan §4.2 item 3): the item id format.
const ITEM_ID = /^[A-Za-z0-9_-]{1,100}$/
const PDF_MAGIC = '%PDF-'
/**
 * Largest JSON success body read. An envelope read is small: its items carry a
 * `documentDataId`, never the file. The deprecated `GET /api/v2/document/{id}`
 * embedded `documentData` (with database uploads, the whole PDF in base64:
 * 1,122,716 characters for a signed test document on staging, 2026-10-08), so
 * it overran this cap; no read used here may embed file data.
 */
const MAX_JSON_BYTES = 1024 * 1024
/** Largest error body read (only `cancel` and `delete` read one, for their 404). */
const MAX_ERROR_BYTES = 64 * 1024

const TERMINAL_EVENTS = new Set([
  'DOCUMENT_COMPLETED',
  'DOCUMENT_REJECTED',
  'DOCUMENT_CANCELLED',
])

/** Whether `value` is a well-formed envelope id (`ENVELOPE_ID`). */
export function isEnvelopeId(value: unknown): value is string {
  return typeof value === 'string' && ENVELOPE_ID.test(value)
}

/**
 * The webhook claim id (design §2.7, PS Hub `idempotency.ts`, E-4):
 * `<org id>:<event>:<envelope id>[:<version>]`. The org comes first because
 * claims are unique per provider, while Documenso ids are per instance and
 * each clinic has its own: two clinics' envelopes with one id are two
 * envelopes, and one's event must never be taken for a duplicate of the
 * other's. `event` is Documenso's name (`DOCUMENT_COMPLETED`). A terminal
 * event happens once per envelope, so its id has no version: a replay with a
 * new timestamp stays a duplicate. Other events add the version (the caller
 * passes an ISO timestamp: the webhook's `createdAt`, else the envelope's
 * `updatedAt`), or `unversioned`. Bounded at 36 + 1 + 64 (event) + 1 + 73
 * (`ENVELOPE_ID`) + 1 + 24 = 200 characters, `webhook_events.event_id`'s limit.
 */
export function documensoEventId(
  orgId: string,
  event: string,
  envelopeId: string,
  version: string | null,
): string {
  const prefix = `${orgId}:${event}:${envelopeId}`
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

/** The create answer: the envelope id (checked with `isEnvelopeId` after). */
const createdSchema = z.object({ id: z.string() })

/** `{ data: [...] }`, the list `ping` reads. */
const listSchema = z.object({ data: z.array(z.unknown()) })

/** Documenso's error body for a missing envelope. */
// VERIFY against the clinic instance (plan §4.2 item 5, R2): the read's 404 is
// documented (`{ message, code, issues? }`, `code` the tRPC code); the
// cancel's and the delete's answer for a missing envelope is not.
const notFoundSchema = z.object({
  message: z.string(),
  code: z.literal('NOT_FOUND'),
})

const nullableString = z.string().nullish().transform((v) => v ?? null)

/**
 * The envelope read (`GET /api/v2/envelope/{id}`). Unknown fields are dropped
 * (zod's default), recipients' `token` among them; nothing here is file data
 * (`MAX_JSON_BYTES`).
 */
const envelopeSchema = z.object({
  id: z.string(),
  status: z.enum(['DRAFT', 'PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED']),
  completedAt: nullableString,
  // The 2.20 OpenAPI's envelope read: `externalId`, a string or null, always
  // present (checked 2026-10-08); the create payload's `externalId` is a
  // string of at most 255. Required here: a read without the field is a bad
  // response (`provider_error`), never an envelope « held under no id », so a
  // re-send stops on `previous_read_failed` (retryable) instead of taking the
  // envelope for another's.
  // VERIFY against the clinic instance (plan §4.2 item 3): the read carries
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
  envelopeItems: z.array(z.object({ id: z.string() })),
})

type Operation =
  | 'create'
  | 'read'
  | 'distribute'
  | 'redistribute'
  | 'cancel'
  | 'delete'
  | 'download'
  | 'ping'

function statusError(
  operation: Operation,
  status: number,
  notFound = false,
): DocumensoError {
  return new DocumensoError(
    status === 401 || status === 403 ? 'not_configured' : 'provider_error',
    status,
    `Documenso ${operation} failed (${status})`,
    null,
    notFound,
  )
}

function badResponse(operation: Operation, status: number): DocumensoError {
  return new DocumensoError(
    'provider_error',
    status,
    `Documenso ${operation}: unexpected response`,
  )
}

function invalidId(operation: Operation): DocumensoError {
  return new DocumensoError(
    'provider_error',
    null,
    `Documenso ${operation}: invalid id`,
  )
}

/** The envelope id, after checking its form (before any request). */
function envelopeId(id: string, operation: Operation): string {
  if (!isEnvelopeId(id)) throw invalidId(operation)
  return id
}

/** A recipient id as a JSON number, after checking its form. */
function recipientId(id: string, operation: Operation): number {
  if (!NUMERIC_ID.test(id)) throw invalidId(operation)
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
      // `gone` reads a 404's body (Documenso's NOT_FOUND?) and drops any other.
      throw statusError(operation, exchange.res.status, await gone(exchange))
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

  /** The envelope, checked to be the one asked for. */
  async function readEnvelope(id: string) {
    const exchange = await ok(
      'read',
      DOCUMENSO_PATHS.envelope(envelopeId(id, 'read')),
      { method: 'GET' },
    )
    const envelope = await parsed(exchange, envelopeSchema)
    if (envelope.id !== id) throw badResponse('read', exchange.res.status)
    return envelope
  }

  /**
   * Whether a refused answer means « already gone »: a 404 whose body is
   * Documenso's own `NOT_FOUND` error. A proxy's or another server's 404 (a
   * wrong base URL) is not. The body is read (≤ 64 KB) only for that.
   */
  async function gone(exchange: Exchange): Promise<boolean> {
    if (exchange.res.status !== 404) {
      await discard(exchange)
      return false
    }
    const body = await readJson(exchange, MAX_ERROR_BYTES)
    return notFoundSchema.safeParse(body).success
  }

  /** Deletes a draft (E-8); already gone is done. */
  async function remove(id: string): Promise<void> {
    const exchange = await send('delete', DOCUMENSO_PATHS.delete, {
      method: 'POST',
      json: { envelopeId: id },
    })
    if (exchange.res.ok) return await discard(exchange)
    if (await gone(exchange)) return
    throw statusError('delete', exchange.res.status)
  }

  /** Refuses input Documenso would accept wrongly, or refuse (`invalid_request`). */
  function checkInput(input: CreateEnvelopeInput): void {
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
    // The OpenAPI's limits (R8): refused here rather than as Documenso's 400.
    if (input.meta.subject.length > 254) refuse('the subject is too long')
    if (input.meta.message.length > 5000) refuse('the message is too long')
  }

  return {
    async createEnvelope(pdf, input) {
      checkInput(input)
      const { expiryDays, ...meta } = input.meta
      const form = new FormData()
      form.append(
        'payload',
        JSON.stringify({
          title: input.title,
          type: 'DOCUMENT',
          externalId: input.externalId,
          recipients: input.recipients.map((r) => ({
            email: r.email,
            name: r.name,
            role: r.role,
            signingOrder: r.signingOrder,
            // `identifier`: the PDF's index in `files` (E-5); no fieldMeta.
            fields: r.fields.map((f) => ({
              identifier: 0,
              type: f.type,
              page: f.page,
              positionX: f.x,
              positionY: f.y,
              width: f.width,
              height: f.height,
            })),
          })),
          meta: {
            ...meta,
            dateFormat: DATE_FORMAT,
            ...(expiryDays === undefined ? {} : {
              envelopeExpirationPeriod: { unit: 'day', amount: expiryDays },
            }),
            // No owner email when a signing link expires (E-13): the app shows
            // it and its daily job closes the request. Documenso fills the
            // other settings with its defaults (all on), which replace the
            // org's email preferences for this envelope; the clinic keeps
            // them at those defaults (runbook §6).
            emailSettings: { ownerRecipientExpired: false },
          },
        }),
      )
      // A fixed file name: the title can name a person (Loi 25).
      form.append(
        'files',
        new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        'document.pdf',
      )
      const exchange = await ok('create', DOCUMENSO_PATHS.create, {
        method: 'POST',
        body: form,
      })
      const created = await parsed(exchange, createdSchema)
      // Without a well-formed id there is nothing to address (R7): the draft
      // stays at Documenso, never emailed.
      if (!isEnvelopeId(created.id)) {
        throw badResponse('create', exchange.res.status)
      }
      const id = created.id
      try {
        const envelope = await readEnvelope(id)
        const recipients = input.recipients.map(({ email }) => {
          const match = envelope.recipients.find((r) =>
            r.email.toLowerCase() === email.toLowerCase()
          )
          if (!match) throw badResponse('read', 200)
          return { id: String(match.id), email }
        })
        return { envelopeId: id, recipients }
      } catch (error) {
        const e = error instanceof DocumensoError
          ? error
          : badResponse('read', 200)
        throw new DocumensoError(e.code, e.status, e.message, id, e.notFound)
      }
    },

    async distribute(id) {
      // The answer carries each recipient's token and signing URL: discarded
      // unread.
      await done('distribute', DOCUMENSO_PATHS.distribute, {
        method: 'POST',
        json: { envelopeId: envelopeId(id, 'distribute') },
      })
    },

    async redistribute(id, recipientIds) {
      if (recipientIds.length === 0) return
      // As `distribute`: the answer (tokens, signing URLs) is discarded unread.
      await done('redistribute', DOCUMENSO_PATHS.redistribute, {
        method: 'POST',
        json: {
          envelopeId: envelopeId(id, 'redistribute'),
          recipients: recipientIds.map((r) => recipientId(r, 'redistribute')),
        },
      })
    },

    async get(id) {
      const envelope = await readEnvelope(id)
      return {
        status: envelope.status,
        completedAt: envelope.completedAt,
        externalId: envelope.externalId,
        recipients: envelope.recipients.map((r) => ({
          id: String(r.id),
          signingOrder: r.signingOrder,
          signingStatus: r.signingStatus,
          readStatus: r.readStatus,
          signedAt: r.signedAt,
          rejectionReason: r.rejectionReason,
        })),
      }
    },

    async cancel(id, { reason, draft = false } = {}) {
      envelopeId(id, 'cancel')
      if (draft) return await remove(id)
      const exchange = await send('cancel', DOCUMENSO_PATHS.cancel, {
        method: 'POST',
        json: { envelopeId: id, ...(reason === undefined ? {} : { reason }) },
      })
      const { status } = exchange.res
      if (exchange.res.ok) return await discard(exchange)
      if (await gone(exchange)) return
      if (status === 400) {
        // Documenso cancels only a pending envelope: already cancelled is
        // done, a draft is deleted, anything else (completed, rejected) is
        // the cancel's error. The read-back's own error never replaces it.
        let current: DocumensoEnvelopeStatus | null = null
        try {
          current = (await readEnvelope(id)).status
        } catch {
          // The cancel's own error is the one to report.
        }
        if (current === 'CANCELLED') return
        if (current === 'DRAFT') return await remove(id)
      }
      throw statusError('cancel', status)
    },

    async downloadSigned(id) {
      const { envelopeItems } = await readEnvelope(id)
      // The app creates one file per envelope (R10: several → not stored).
      if (envelopeItems.length !== 1 || !ITEM_ID.test(envelopeItems[0].id)) {
        throw badResponse('download', 200)
      }
      const exchange = await ok(
        'download',
        `${DOCUMENSO_PATHS.download(envelopeItems[0].id)}?version=signed`,
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
