/**
 * Following Documenso after a request is sent (design §6.3, Task 3.33):
 * mapping an envelope's state or a webhook to `apply_signing_event` calls,
 * storing the signed PDF, syncing one request, and the daily reconcile.
 * Used by `signing-webhook`, `signing-sync` and `_shared/signing.ts`.
 *
 * **Render-free on purpose:** nothing here imports `pdf/render.ts`, so the
 * webhook and the sync function do not carry pdfmake (ADR 0008,
 * `pdf/isolation.test.ts`). Request creation, which renders, lives in
 * `signing.ts`.
 *
 * - **Events** use Documenso's raw names (`DOCUMENT_COMPLETED`); PS Hub's
 *   dot names (`document.completed`) are mapped to them. An envelope's state
 *   becomes events per recipient (signed, else opened), then its terminal
 *   status; `apply_signing_event` is monotonic, so replaying them is safe.
 * - **Recipients** are matched to signers by Documenso's recipient id, or by
 *   signing order for a draft (never by address).
 * - **The signed PDF** is downloaded (streamed, capped at the bucket's
 *   20 MB), sniffed, hashed, registered (`register_system_file`, purpose
 *   `signing_signed`, the request's view permission), uploaded to its own
 *   path (`upsert: false`: a retry registers a new file), then
 *   `complete_signature_request`. A failed upload discards the registered
 *   row (`discard_system_file`).
 * - **Drafts are claimed** (`begin_signature_request_send`, `claimDraft`)
 *   before anything settles them, so a settle never runs beside a send
 *   (« Renvoyer ») or another settle; a draft whose claim is fresh is
 *   skipped (`sending`). A failure after the claim releases it
 *   (`mark_signature_request_failed` with the code).
 * - **Only the request's own envelope** is acted on: Documenso holds it
 *   under the request's id (`externalId`, set at creation). Another envelope
 *   under a draft's recorded id (an org that changed Documenso instance) is
 *   reported `signing_foreign_document` (ids only), never recovered nor
 *   cancelled, and otherwise treated as one Documenso no longer has. For a
 *   sent request, another envelope fails the sync with
 *   `signing_foreign_document` before any event is applied, and a signed
 *   PDF is only downloaded for the envelope the request still records.
 *   (`set_signing_settings` refuses an instance change while a request is
 *   open, so this is a last guard.)
 * - **A settle reads under its claim:** the draft is re-read
 *   (`get_signing_request`) once claimed, and settled against its current
 *   envelope (a send may have recorded another one since the list), read
 *   again at Documenso when it changed.
 * - **A draft Documenso completed** (a send that died before
 *   `mark_signature_request_sent`, or a re-send's earlier envelope): with
 *   every signer matched by signing order, `recover_signature_request` makes
 *   it sent on its recorded envelope with its completion stamped, taking its rendered PDF when still
 *   staged (else the source is recorded missing and reported
 *   `signing_source_missing`: the signed PDF is what matters), then the
 *   signed PDF is stored as usual. Unmatched, it is reported
 *   `signing_orphan_completed` (ids only) and left a draft
 *   (`orphan_completed`): never cancelled (the contract is signed at
 *   Documenso) and never abandoned (that would free its record for a second
 *   contract). Someone settles it by hand.
 *
 * Nothing here logs an address, a name or a body: failures are codes, and
 * reports carry the org, request and envelope ids.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isLocalAppUrl } from './auth.ts'
import {
  denoResolveDns,
  type DocumensoClient,
  documensoClient,
  type DocumensoEnvelopeState,
  DocumensoError,
  type DocumensoReach,
  type ResolveDns,
} from './documenso.ts'
import type { PerOrg } from './jobs.ts'
import { reportError } from './report.ts'
import { sha256Hex, sniff } from './storage.ts'

/** A failure with a safe code (`runJob` records it; webhooks fail the claim with it). */
export class SigningFailure extends Error {
  constructor(
    readonly code: string,
    /** The request concerned, when one exists (for reports). */
    readonly requestId: string | null = null,
  ) {
    super(code)
    this.name = 'SigningFailure'
  }
}

/** One `apply_signing_event` call. */
export interface SigningEvent {
  event: string
  recipientId: string | null
  /** The provider's time (ISO); null lets the database use now. */
  at: string | null
  reason: string | null
}

/** What an envelope state or a webhook payload says (no address needed). */
export interface DocumentSnapshot {
  status?: string
  completedAt?: string | null
  recipients: {
    id: string
    readStatus?: string
    signingStatus?: string
    signedAt?: string | null
    rejectionReason?: string | null
  }[]
}

/** The `signing_signed` purpose and the `signed-documents` bucket cap (Task 3.31). */
export const SIGNED_PDF_MAX_BYTES = 20 * 1024 * 1024
/** A send claim older than this is a send that died (edge wall clock: 400 s at most). */
export const STALE_SEND_MS = 10 * 60_000
/** `STALE_SEND_MS` as the interval `begin_signature_request_send` takes. */
const STALE_AFTER = `${STALE_SEND_MS / 1000} seconds`
/**
 * The reconcile job's cap per org (`runJob`'s `perOrgTimeoutMs`): under the
 * edge idle timeout (150 s), the job usually running one clinic.
 */
export const RECONCILE_TIMEOUT_MS = 120_000
/** After this, the reconcile picks no new request (the rest waits for the next run). */
export const RECONCILE_SOFT_DEADLINE_MS = 90_000
/** Requests reconciled at once per org (plan Task 3.33). */
const CONCURRENCY = 4
/** `list_signature_requests_to_reconcile` returns at most 100 rows. */
const RECONCILE_LIMIT = 100
const EVENT_NAME = /^[A-Za-z_.]{1,64}$/

/**
 * Documenso's raw event name (`DOCUMENT_COMPLETED`), from itself or from
 * PS Hub's dot form (`document.completed`); null when it is not a name.
 */
export function normaliseEventName(name: string): string | null {
  if (!EVENT_NAME.test(name)) return null
  return name.toUpperCase().replaceAll('.', '_')
}

const event = (
  name: string,
  recipientId: string | null = null,
  at: string | null = null,
  reason: string | null = null,
): SigningEvent => ({ event: name, recipientId, at, reason })

/**
 * The events a document's state implies, in order: per recipient, signed
 * (which also marks it viewed) or else opened; then the terminal status.
 */
export function documentEvents(doc: DocumentSnapshot): SigningEvent[] {
  const events: SigningEvent[] = []
  for (const r of doc.recipients) {
    if (r.signingStatus === 'SIGNED') {
      events.push(event('DOCUMENT_SIGNED', r.id, r.signedAt ?? null))
    } else if (r.readStatus === 'OPENED' && r.signingStatus !== 'REJECTED') {
      events.push(event('DOCUMENT_OPENED', r.id))
    }
  }
  return [...events, ...terminalEvents(doc.status, doc, null)]
}

function terminalEvents(
  status: string | undefined,
  doc: DocumentSnapshot,
  at: string | null,
): SigningEvent[] {
  switch (status) {
    case 'COMPLETED':
      return [event('DOCUMENT_COMPLETED', null, doc.completedAt ?? at)]
    case 'REJECTED': {
      const r = doc.recipients.find((r) => r.signingStatus === 'REJECTED')
      return [
        event('DOCUMENT_REJECTED', r?.id ?? null, at, r?.rejectionReason),
      ]
    }
    case 'CANCELLED':
      return [event('DOCUMENT_CANCELLED', null, at)]
    default:
      return []
  }
}

/**
 * The calls one webhook makes: only what its event says, read from the
 * payload's recipients (`at` is the webhook's time, the fallback stamp).
 * An event the database does not track (`DOCUMENT_CREATED`, `DOCUMENT_SENT`)
 * makes none.
 */
export function webhookEvents(
  name: string,
  doc: DocumentSnapshot,
  at: string | null,
): SigningEvent[] {
  switch (name) {
    case 'DOCUMENT_OPENED': {
      const opened = doc.recipients.filter((r) => r.readStatus === 'OPENED')
      return opened.length
        ? opened.map((r) => event(name, r.id, at))
        : [event(name, null, at)]
    }
    case 'DOCUMENT_SIGNED':
    case 'DOCUMENT_RECIPIENT_COMPLETED':
      return doc.recipients.filter((r) => r.signingStatus === 'SIGNED')
        .map((r) => event(name, r.id, r.signedAt ?? at))
    case 'DOCUMENT_COMPLETED':
      return [event(name, null, doc.completedAt ?? at)]
    case 'DOCUMENT_REJECTED':
      return terminalEvents('REJECTED', doc, at)
    case 'DOCUMENT_CANCELLED':
      return [event(name, null, at)]
    default:
      return []
  }
}

/** The combined answer of `apply_signing_event` calls. */
export interface ApplyResult {
  outcome: 'applied' | 'ignored' | 'not_found' | 'retry'
  requestId: string | null
  needsDownload: boolean
}

const applyRowSchema = z.object({
  outcome: z.enum(['applied', 'ignored', 'not_found', 'retry']),
  request_id: z.string().nullable(),
  needs_download: z.boolean(),
})

/**
 * Applies `events` in order (they lock one row, so never in parallel), each
 * to the request `ref.requestId` (the envelope's `externalId`: never found
 * by envelope id alone). `retry` and `not_found` stop at once. `applied`
 * when any call changed the row; `needsDownload` when any asked for the
 * signed PDF.
 */
export async function applyEvents(
  client: SupabaseClient,
  orgId: string,
  ref: { requestId: string; envelopeId: string | null },
  events: SigningEvent[],
): Promise<ApplyResult> {
  const result: ApplyResult = {
    outcome: 'ignored',
    requestId: ref.requestId,
    needsDownload: false,
  }
  for (const e of events) {
    const { data, error } = await client.rpc('apply_signing_event', {
      p_org_id: orgId,
      p_request_id: ref.requestId,
      p_envelope_id: ref.envelopeId,
      p_event: e.event,
      p_recipient_id: e.recipientId,
      p_at: e.at,
      p_reason: e.reason,
    })
    const row = applyRowSchema.safeParse(Array.isArray(data) ? data[0] : null)
    if (error || !row.success) throw new SigningFailure('apply_failed')
    const { outcome, request_id, needs_download } = row.data
    if (outcome === 'retry' || outcome === 'not_found') {
      return { outcome, requestId: request_id, needsDownload: false }
    }
    if (outcome === 'applied') result.outcome = 'applied'
    result.requestId = request_id ?? result.requestId
    result.needsDownload ||= needs_download
  }
  return result
}

const signingRequestSchema = z.object({
  id: z.string(),
  module_key: z.string(),
  status: z.string(),
  last_error: z.string().nullable(),
  view_permission: z.string(),
  envelope_id: z.string().nullable(),
  staged_source_file_id: z.string().nullable(),
  signers: z.array(z.object({
    role: z.string(),
    order: z.number().int(),
    recipient_id: z.string().nullable(),
  })),
})

/** One request as the service role reads it (`get_signing_request`). */
export type SigningRequest = z.infer<typeof signingRequestSchema>

/** The request of the org, or null when it has none with that id. */
export async function getSigningRequest(
  client: SupabaseClient,
  orgId: string,
  id: string,
): Promise<SigningRequest | null> {
  const { data, error } = await client.rpc('get_signing_request', {
    p_org_id: orgId,
    p_id: id,
  })
  if (error) throw new SigningFailure('request_lookup_failed')
  if (data === null) return null
  const parsed = signingRequestSchema.safeParse(data)
  if (!parsed.success) throw new SigningFailure('request_lookup_failed')
  return parsed.data
}

/**
 * Claims a live draft for one send or settle (`begin_signature_request_send`
 * with `STALE_SEND_MS`): false when it is no longer a live draft or another
 * claim is fresh (a send under way).
 */
export async function claimDraft(
  client: SupabaseClient,
  orgId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('begin_signature_request_send', {
    p_org_id: orgId,
    p_id: id,
    p_stale_after: STALE_AFTER,
  })
  if (error) throw new SigningFailure('claim_failed', id)
  return data === true
}

/**
 * Marks a draft failed with `code` (`mark_signature_request_failed`), which
 * releases its claim; the envelope id is recorded when given. Best
 * effort: an error is reported (ids only), never thrown.
 */
export async function markDraftFailed(
  client: SupabaseClient,
  report: { fn: string; orgId: string; fetch: typeof fetch },
  id: string,
  code: string,
  ids: { envelopeId?: string | null } = {},
): Promise<void> {
  const { error } = await client.rpc('mark_signature_request_failed', {
    p_id: id,
    p_error_code: code,
    p_envelope_id: ids.envelopeId ?? null,
  })
  if (error) {
    await reportError({
      fn: report.fn,
      code: 'mark_failed_failed',
      ids: { org_id: report.orgId, signature_request_id: id },
    }, report.fetch)
  }
}

/**
 * Where an org's Documenso client may send requests (P3-34): local dev only
 * when `APP_URL` is a local http URL (`isLocalAppUrl`), so the fake at
 * `http://host.docker.internal` is refused on a deployed project; the
 * resolver is the deps' (tests inject a fake), else `Deno.resolveDns`.
 */
export function documensoReach(deps: {
  env: (key: string) => string | undefined
  resolveDns?: ResolveDns
}): DocumensoReach {
  return {
    local: isLocalAppUrl(deps.env('APP_URL')),
    resolveDns: deps.resolveDns ?? denoResolveDns,
  }
}

/** An org's Documenso client and its request expiry. */
export interface OrgSigning {
  documenso: DocumensoClient
  expiryDays: number
}

const credentialsSchema = z.object({
  base_url: z.string().nullable(),
  api_key: z.string().nullable(),
  expiry_days: z.number().int().positive(),
})

/** What `get_signing_credentials` answered for an org. */
export type SigningCredentials = z.infer<typeof credentialsSchema>

/**
 * The org's Documenso address, API key and expiry, read together in one
 * statement (`get_signing_credentials`): a key is only ever paired with the
 * address it was typed for (`set_signing_settings` deletes it in the same
 * transaction as an origin change; two separate reads could pair the new
 * address with the old key). Throws `signing_config_failed` on an RPC error
 * or an unexpected answer (no row: an org without signing settings).
 */
export async function signingCredentials(
  client: SupabaseClient,
  orgId: string,
): Promise<SigningCredentials> {
  const { data, error } = await client.rpc('get_signing_credentials', {
    p_org_id: orgId,
  })
  const parsed = credentialsSchema.safeParse(
    Array.isArray(data) ? data[0] : null,
  )
  if (error || !parsed.success) {
    throw new SigningFailure('signing_config_failed')
  }
  return parsed.data
}

/**
 * The org's Documenso (`signingCredentials`), or null when the URL or the key
 * is not set. Downloads are capped at `SIGNED_PDF_MAX_BYTES`; requests go
 * only where `reach` allows (`documensoReach`).
 */
export async function orgSigning(
  client: SupabaseClient,
  orgId: string,
  fetchFn: typeof fetch,
  reach: DocumensoReach,
  signal?: AbortSignal,
): Promise<OrgSigning | null> {
  const { base_url, api_key, expiry_days } = await signingCredentials(
    client,
    orgId,
  )
  if (!base_url || !api_key) return null
  return {
    documenso: documensoClient(base_url, api_key, fetchFn, {
      signal,
      maxDownloadBytes: SIGNED_PDF_MAX_BYTES,
      reach,
    }),
    expiryDays: expiry_days,
  }
}

const registeredSchema = z.object({
  file_id: z.string(),
  object_path: z.string(),
})

/**
 * Registers a system file and uploads its bytes (`upsert: false`). A failed
 * upload soft-deletes the row (best effort: it is staged, so storage-cleanup
 * purges it anyway) and throws `uploadCode`.
 */
export async function storeSystemFile(
  client: SupabaseClient,
  file: {
    orgId: string
    bucket: 'documents' | 'signed-documents'
    purpose: 'signing_source' | 'signing_signed'
    requestId: string
    viewPermission: string
    name: string
    bytes: Uint8Array
  },
  codes: { register: string; upload: string },
): Promise<string> {
  const registered = await client.rpc('register_system_file', {
    p_org_id: file.orgId,
    p_bucket: file.bucket,
    p_module_key: 'core',
    p_purpose: file.purpose,
    p_subject_type: 'signature_request',
    p_subject_id: file.requestId,
    p_mime_type: 'application/pdf',
    p_size_bytes: file.bytes.length,
    p_sha256: sha256Hex(file.bytes),
    p_view_permission: file.viewPermission,
    p_original_name: file.name,
  })
  const row = registeredSchema.safeParse(
    Array.isArray(registered.data) ? registered.data[0] : null,
  )
  if (registered.error || !row.success) throw new SigningFailure(codes.register)
  const { file_id, object_path } = row.data
  const upload = await client.storage.from(file.bucket).upload(
    object_path,
    file.bytes,
    { contentType: 'application/pdf', upsert: false },
  )
  if (upload.error) {
    await client.rpc('discard_system_file', {
      p_org_id: file.orgId,
      p_file_id: file_id,
    })
    throw new SigningFailure(codes.upload)
  }
  return file_id
}

/**
 * Downloads the signed PDF of a completed envelope and completes the
 * request with it (module comment). When `complete_signature_request`
 * refuses because another delivery (a webhook beside the sync) stored its
 * own PDF first, the request reads back `signed`: this file is discarded
 * and that counts as done. Throws `DocumensoError` or a `SigningFailure`
 * (`signed_pdf_invalid`, `signed_register_failed`, `signed_upload_failed`,
 * `complete_failed`).
 */
export async function storeSignedPdf(
  client: SupabaseClient,
  documenso: DocumensoClient,
  orgId: string,
  request: { id: string; envelopeId: string; viewPermission: string },
): Promise<void> {
  const bytes = await documenso.downloadSigned(request.envelopeId)
  if (sniff(bytes) !== 'pdf') throw new SigningFailure('signed_pdf_invalid')
  const fileId = await storeSystemFile(client, {
    orgId,
    bucket: 'signed-documents',
    purpose: 'signing_signed',
    requestId: request.id,
    viewPermission: request.viewPermission,
    name: 'Document signé.pdf',
    bytes,
  }, { register: 'signed_register_failed', upload: 'signed_upload_failed' })
  const completed = await client.rpc('complete_signature_request', {
    p_id: request.id,
    p_signed_file_id: fileId,
    p_signed_sha256: sha256Hex(bytes),
  })
  if (completed.error) {
    const current = await getSigningRequest(client, orgId, request.id)
      .catch(() => null)
    if (current?.status !== 'signed') {
      throw new SigningFailure('complete_failed')
    }
    // Staged, so storage-cleanup purges it anyway if this fails.
    await client.rpc('discard_system_file', {
      p_org_id: orgId,
      p_file_id: fileId,
    })
  }
}

/** Everything one org's sync needs. */
export interface SyncContext {
  client: SupabaseClient
  orgId: string
  signing: OrgSigning
  now: () => Date
  /** For reports: the function's name. */
  fn: string
  fetch: typeof fetch
}

/** What syncing one request did (`sending`: a draft claimed by a send, skipped). */
export type SyncOutcome =
  | 'signed'
  | 'updated'
  | 'unchanged'
  | 'abandoned'
  | 'expired'
  | 'orphan_completed'
  | 'sending'

/** A request row as the sync needs it (from any of the read RPCs). */
export interface SyncRow {
  id: string
  status: string
  envelope_id: string | null
}

/** The view permission (and the rest) of a request about to be stored. */
async function requireRequest(
  ctx: SyncContext,
  id: string,
): Promise<SigningRequest> {
  const request = await getSigningRequest(ctx.client, ctx.orgId, id)
  if (!request) throw new SigningFailure('request_not_found')
  return request
}

/**
 * Whether `state` is the request's own envelope: Documenso holds it under
 * the request's id (`externalId`, set by `createEnvelope`).
 */
export function ownsEnvelope(
  state: Pick<DocumensoEnvelopeState, 'externalId'>,
  requestId: string,
): boolean {
  return state.externalId === requestId
}

/**
 * A draft's envelope as Documenso has it: null when gone (404, deleted when
 * a send failed) or not the request's own (`ownsEnvelope`; reported
 * `signing_foreign_document`, ids only, then treated as gone: never
 * recovered nor cancelled).
 */
export async function readDraftEnvelope(
  report: { fn: string; orgId: string; fetch: typeof fetch },
  documenso: DocumensoClient,
  requestId: string,
  envelopeId: string,
): Promise<DocumensoEnvelopeState | null> {
  let state: DocumensoEnvelopeState
  try {
    state = await documenso.get(envelopeId)
  } catch (error) {
    if (error instanceof DocumensoError && error.status === 404) return null
    throw error
  }
  if (ownsEnvelope(state, requestId)) return state
  await reportError({
    fn: report.fn,
    code: 'signing_foreign_document',
    ids: {
      org_id: report.orgId,
      signature_request_id: requestId,
      envelope_id: envelopeId,
    },
  }, report.fetch)
  return null
}

/**
 * Reads the envelope at Documenso and applies what changed; stores the
 * signed PDF when the request is completed. A draft is settled by
 * `settleDraft`, once claimed: with `settleDrafts` (the reconcile, for a
 * draft whose send started over an hour ago) a completed one is recovered
 * and any other cancelled and abandoned; without it (a user's
 * « Synchroniser ») only a completed one is recovered.
 */
export async function syncRequest(
  ctx: SyncContext,
  row: SyncRow,
  options: { settleDrafts: boolean },
): Promise<SyncOutcome> {
  const envelopeId = row.envelope_id
  if (!envelopeId) return 'unchanged'
  const { documenso } = ctx.signing
  if (row.status === 'draft') {
    const state = await readDraftEnvelope(ctx, documenso, row.id, envelopeId)
    return await settleDraft(ctx, row, envelopeId, state, options.settleDrafts)
  }
  const state = await documenso.get(envelopeId)
  // Only the request's own envelope (module comment): checked before any
  // event is applied.
  if (!ownsEnvelope(state, row.id)) {
    throw new SigningFailure('signing_foreign_document', row.id)
  }
  const result = await applyEvents(ctx.client, ctx.orgId, {
    requestId: row.id,
    envelopeId,
  }, documentEvents(state))
  if (result.outcome === 'retry' || result.outcome === 'not_found') {
    throw new SigningFailure(`apply_${result.outcome}`)
  }
  if (result.needsDownload) {
    const request = await requireRequest(ctx, row.id)
    // And the envelope the request records now, read before downloading.
    if (request.envelope_id !== envelopeId) {
      throw new SigningFailure('signing_foreign_document', row.id)
    }
    await storeSignedPdf(ctx.client, documenso, ctx.orgId, {
      id: row.id,
      envelopeId,
      viewPermission: request.view_permission,
    })
    return 'signed'
  }
  return result.outcome === 'applied' ? 'updated' : 'unchanged'
}

/**
 * Settles a draft (`syncRequest`): `state` is what the caller read for
 * `envelopeId` (null: gone, or not the request's own), which only decides
 * whether to claim. Once claimed, the draft is re-read and settled against
 * its current envelope: a send that ended between the read and the claim
 * may have recorded another one, read again here.
 */
async function settleDraft(
  ctx: SyncContext,
  row: SyncRow,
  envelopeId: string,
  state: DocumensoEnvelopeState | null,
  cancelStale: boolean,
): Promise<SyncOutcome> {
  if (state?.status !== 'COMPLETED' && !cancelStale) return 'unchanged'
  if (!(await claimDraft(ctx.client, ctx.orgId, row.id))) return 'sending'
  try {
    const request = await requireRequest(ctx, row.id)
    const currentId = request.envelope_id
    let current = state
    if (currentId !== envelopeId) {
      current = currentId === null ? null : await readDraftEnvelope(
        ctx,
        ctx.signing.documenso,
        row.id,
        currentId,
      )
    }
    if (current?.status === 'COMPLETED') {
      return await recoverCompletedDraft(ctx, request, currentId!, current)
    }
    if (!cancelStale) {
      // Read completed, but the draft's envelope changed under the claim
      // (a send failed since) and this one is not: released, left as is.
      await markDraftFailed(ctx.client, ctx, row.id, 'send_failed')
      return 'unchanged'
    }
    if (current?.status === 'DRAFT' || current?.status === 'PENDING') {
      // Documenso cancels only a pending envelope: a draft is deleted (E-8).
      await ctx.signing.documenso.cancel(currentId!, {
        draft: current.status === 'DRAFT',
      })
    }
    const failed = await ctx.client.rpc('mark_signature_request_failed', {
      p_id: row.id,
      p_error_code: 'abandoned',
    })
    if (failed.error) throw new SigningFailure('mark_failed_failed')
    return 'abandoned'
  } catch (error) {
    // Release the claim (a no-op once the draft is recovered or abandoned).
    const raw = (error as { code?: unknown }).code
    await releaseClaim(ctx, row.id, typeof raw === 'string' ? raw : 'internal')
    throw error
  }
}

/** Releases a draft's claim after a failed settle, quietly once it is no longer a draft. */
async function releaseClaim(
  ctx: SyncContext,
  id: string,
  code: string,
): Promise<void> {
  const current = await getSigningRequest(ctx.client, ctx.orgId, id)
    .catch(() => null)
  if (current?.status !== 'draft') return
  await markDraftFailed(
    ctx.client,
    ctx,
    id,
    /^[a-z0-9_]{1,64}$/.test(code) ? code : 'settle_failed',
  )
}

/**
 * `[{role, recipient_id}]` by signing order, or null when a signer has no
 * match. Matching by order is sound because the stored orders are the ones
 * every send of the request gave Documenso: `create_signature_request`
 * refuses the same idempotency key with other signers (role, order, name or
 * address), and a send gives Documenso the caller's signers in their order.
 */
function recipientsByOrder(
  signers: SigningRequest['signers'],
  recipients: { id: string; signingOrder: number | null }[],
): { role: string; recipient_id: string }[] | null {
  const matched = signers.map((s) => {
    const found = recipients.filter((r) => r.signingOrder === s.order)
    return found.length === 1
      ? { role: s.role, recipient_id: found[0].id }
      : null
  })
  return matched.every((m) => m !== null) &&
      recipients.length === signers.length
    ? matched as { role: string; recipient_id: string }[]
    : null
}

/**
 * A draft Documenso completed (module comment); the caller holds its claim,
 * read `request` under it, and read `state` COMPLETED for the draft's
 * recorded envelope. Only that envelope, held under the request's id, is
 * recovered: anything else throws `foreign_document` (the callers read
 * through `readDraftEnvelope`, so it never comes here). Throws like
 * `storeSignedPdf`, or `recover_failed`.
 */
export async function recoverCompletedDraft(
  ctx: SyncContext,
  request: SigningRequest,
  envelopeId: string,
  state: DocumensoEnvelopeState,
): Promise<'signed' | 'orphan_completed'> {
  const row = { id: request.id }
  if (
    request.envelope_id !== envelopeId ||
    !ownsEnvelope(state, request.id)
  ) {
    throw new SigningFailure('foreign_document', request.id)
  }
  const ids = {
    org_id: ctx.orgId,
    signature_request_id: row.id,
    envelope_id: envelopeId,
  }
  const recipients = recipientsByOrder(request.signers, state.recipients)
  if (!recipients) {
    await reportError(
      { fn: ctx.fn, code: 'signing_orphan_completed', ids },
      ctx.fetch,
    )
    // Released with a code that says why; the draft stays open.
    await markDraftFailed(ctx.client, ctx, row.id, 'orphan_completed')
    return 'orphan_completed'
  }
  const recovered = await ctx.client.rpc('recover_signature_request', {
    p_org_id: ctx.orgId,
    p_id: row.id,
    p_envelope_id: envelopeId,
    p_signer_recipients: recipients,
  })
  if (recovered.error) throw new SigningFailure('recover_failed')
  if (recovered.data === null) {
    // The rendered PDF left staging: the signed one is what matters.
    await reportError(
      { fn: ctx.fn, code: 'signing_source_missing', ids },
      ctx.fetch,
    )
  }
  const result = await applyEvents(ctx.client, ctx.orgId, {
    requestId: row.id,
    envelopeId,
  }, documentEvents(state))
  if (!result.needsDownload) throw new SigningFailure('recover_failed')
  await storeSignedPdf(ctx.client, ctx.signing.documenso, ctx.orgId, {
    id: row.id,
    envelopeId,
    viewPermission: request.view_permission,
  })
  return 'signed'
}

const reconcileSchema = z.array(z.object({
  id: z.string(),
  status: z.string(),
  envelope_id: z.string().nullable(),
  action: z.enum(['sync', 'expire', 'abandon']),
})).max(RECONCILE_LIMIT)

type ReconcileRow = z.infer<typeof reconcileSchema>[number]

/** One listed request (`list_signature_requests_to_reconcile` actions). */
async function reconcileRow(
  client: SupabaseClient,
  orgId: string,
  ctx: SyncContext | null,
  row: ReconcileRow,
): Promise<SyncOutcome> {
  if (row.action === 'abandon') {
    if (!(await claimDraft(client, orgId, row.id))) return 'sending'
    const failed = await client.rpc('mark_signature_request_failed', {
      p_id: row.id,
      p_error_code: 'abandoned',
    })
    if (failed.error) throw new SigningFailure('mark_failed_failed')
    return 'abandoned'
  }
  if (!ctx) throw new SigningFailure('not_configured')
  const outcome = await syncRequest(ctx, row, { settleDrafts: true })
  if (row.action !== 'expire' || outcome === 'signed') return outcome
  // Overdue and still not completed after the sync: expire here first (it
  // refuses a request Documenso completed), then cancel there.
  const expired = await client.rpc('expire_signature_request', { p_id: row.id })
  if (expired.error) throw new SigningFailure('expire_failed')
  if (expired.data !== true) return outcome
  try {
    await ctx.signing.documenso.cancel(row.envelope_id!)
  } catch (error) {
    // Documenso expires the signing links, not the envelope (E-6), so this
    // is normally 200. A 400 means it is no longer pending (completed,
    // rejected or cancelled in between): over there too.
    if (!(error instanceof DocumensoError && error.status === 400)) throw error
  }
  return 'expired'
}

const LABELS: Record<SyncOutcome, [string, string]> = {
  signed: ['signée', 'signées'],
  expired: ['expirée', 'expirées'],
  abandoned: ['abandonnée', 'abandonnées'],
  updated: ['mise à jour', 'mises à jour'],
  unchanged: ['inchangée', 'inchangées'],
  orphan_completed: ['à vérifier', 'à vérifier'],
  sending: ['en cours d’envoi', 'en cours d’envoi'],
}

/** « 3 demandes suivies (1 signée, 2 inchangées) »: counts only. */
function detail(counts: Map<SyncOutcome, number>): string {
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return 'Aucune demande traitée'
  const parts = (Object.keys(LABELS) as SyncOutcome[])
    .filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} ${LABELS[k][counts.get(k)! > 1 ? 1 : 0]}`)
  return `${total} ${total > 1 ? 'demandes suivies' : 'demande suivie'} (${
    parts.join(', ')
  })`
}

/**
 * The `core.signing_reconcile` job's work for one org (`runJob`'s
 * `perOrg`, capped at `RECONCILE_TIMEOUT_MS`): up to 100 listed requests,
 * 4 at a time. After `softDeadlineMs` (default
 * `RECONCILE_SOFT_DEADLINE_MS`) no new batch starts: the rest waits for the
 * next run, and the detail says how many. A request that fails is reported
 * (its id and the error code) and the others go on; then the run fails as
 * `reconcile_failed`, so « Tâches planifiées » shows it.
 */
export function reconcileOrg(
  deps: {
    fetch: typeof fetch
    now: () => Date
    /** Where Documenso requests may go (`documensoReach`). */
    reach: DocumensoReach
    softDeadlineMs?: number
    /** Elapsed time in ms (default `performance.now`). */
    elapsed?: () => number
  },
  fn: string,
): PerOrg {
  const elapsed = deps.elapsed ?? (() => performance.now())
  const softDeadlineMs = deps.softDeadlineMs ?? RECONCILE_SOFT_DEADLINE_MS
  return async (orgId, client, signal) => {
    const deadline = elapsed() + softDeadlineMs
    const listed = await client.rpc('list_signature_requests_to_reconcile', {
      p_org_id: orgId,
      p_limit: RECONCILE_LIMIT,
    })
    const rows = reconcileSchema.safeParse(listed.data)
    if (listed.error || !rows.success) throw new SigningFailure('list_failed')
    if (rows.data.length === 0) return 'Aucune demande à suivre'

    const signing = rows.data.some((r) => r.action !== 'abandon')
      ? await orgSigning(client, orgId, deps.fetch, deps.reach, signal)
      : null
    const ctx: SyncContext | null = signing && {
      client,
      orgId,
      signing,
      now: deps.now,
      fn,
      fetch: deps.fetch,
    }
    const counts = new Map<SyncOutcome, number>()
    let failed = 0
    let done = 0
    for (
      let i = 0;
      i < rows.data.length && !signal.aborted && elapsed() < deadline;
      i += CONCURRENCY
    ) {
      const batch = rows.data.slice(i, i + CONCURRENCY)
      done += batch.length
      await Promise.all(
        batch.map(async (row) => {
          try {
            const outcome = await reconcileRow(client, orgId, ctx, row)
            counts.set(outcome, (counts.get(outcome) ?? 0) + 1)
          } catch (error) {
            failed++
            const code = (error as { code?: unknown }).code
            await reportError({
              fn,
              code: typeof code === 'string' ? code : 'internal',
              ids: { org_id: orgId, signature_request_id: row.id },
            }, deps.fetch)
          }
        }),
      )
    }
    if (failed > 0) throw new SigningFailure('reconcile_failed')
    const left = rows.data.length - done
    return left > 0
      ? `${detail(counts)} ; ${left} à reprendre au prochain passage`
      : detail(counts)
  }
}
