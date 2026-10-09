/**
 * Creating a signature request (design §6.3, Task 3.33): render the PDF on
 * the server, store it, send it through Documenso, and record each step.
 * Module functions call `createSignatureRequest` (Professionnels 4d), and so
 * does `signing-test-document` with the built-in test document.
 *
 * **This module renders** (it imports `pdf/render.ts`, so pdfmake): only
 * functions that create requests may import it. The webhook and the sync use
 * `signing-events.ts` (`pdf/isolation.test.ts`).
 *
 * Order:
 * 1. `get_signing_context` ∥ `get_signing_credentials` (the address and the
 *    key from one statement, so a key is only paired with the address it was
 *    typed for; the address used is that one): a disabled module →
 *    `module_disabled`; no URL or key → `not_configured`; no row.
 * 2. The template is filled (`fillTemplate`, the clinic identity over the
 *    caller's values; the invitation's subject and message too): a missing
 *    value → `missing_variable`, no row. The built-in test document comes
 *    filled.
 * 3. `create_signature_request` (idempotent on the key). An existing row:
 *    - not a draft → returned (`existing`), nothing sent again;
 *    - an abandoned draft → `provider_error` (a new action needs a new key);
 *    - another draft is sent again on the same row (« Renvoyer »).
 *    A P0001 refusal (a request already open for the record, two signers
 *    with one address, the same key with other signers) → `invalid_request`
 *    with its French message.
 * 3b. `begin_signature_request_send` claims the draft (new or existing):
 *    refused while another send's claim is younger than `STALE_SEND_MS` (a
 *    double click, a double « Renvoyer ») → `send_in_progress` « Un envoi
 *    est déjà en cours. » (409), nothing rendered or sent.
 * 3c. A re-sent draft with a Documenso envelope settles that earlier
 *    envelope first (`get_signing_request` read after the claim, then
 *    Documenso): COMPLETED → recovered (`recoverCompletedDraft`: the request
 *    becomes signed) and nothing is sent again; DRAFT → deleted, PENDING →
 *    cancelled (a failed cancel ends the re-send: marked
 *    `previous_cancel_failed`, `provider_error`, retryable); CANCELLED,
 *    REJECTED or gone (404) → sent again. An envelope Documenso does not hold
 *    under the request's id (`externalId`: another instance's under the same
 *    id) is reported `signing_foreign_document` and treated as gone: never
 *    recovered nor cancelled. The new envelope then replaces it (the earlier
 *    id is superseded).
 * 4. The images (logo, signature) the document uses, in parallel → render.
 * 5. `register_system_file` (`documents`, `signing_source`, the request's
 *    view permission) → upload (`upsert: false`); a failed upload discards
 *    the row.
 * 6. Documenso: `createEnvelope` (`externalId` = the request id; recipients
 *    in signing order, each with its role's fields inline: a box whose role
 *    has no signer here is left out; French; the expiry) → `distribute`.
 * 7. `mark_signature_request_sent` (recipients keyed by role, expiry = now +
 *    `expiry_days`, the rendered page count: N, where Documenso's certificate
 *    pages start in the signed PDF, P4-500).
 *
 * A failure from step 4 on marks the draft (`mark_signature_request_failed`
 * with a code, and the envelope id once known), which releases the claim,
 * so a retry with the same key sends again at once. From step 6 on, the
 * envelope is cancelled first, best effort (straight to delete before
 * `distribute`, else cancel with the fallback, E-8). Documenso failures answer `provider_error`
 * (`not_configured` for a refused key); the others throw a
 * `SigningFailure` with a code (the caller answers 500 and reports it).
 * Nothing logs an address: codes and ids only.
 *
 * **The caller's connection never drives the send:** once claimed, a send
 * runs to its end (or to `SEND_TIMEOUT_MS`, its own deadline on every
 * Documenso call), whether or not the browser is still waiting. A cleanup
 * cancel has its own client and timeout (`CANCEL_TIMEOUT_MS`), so it runs
 * even after the send's deadline fired.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  type DocumensoClient,
  documensoClient,
  type DocumensoEnvelopeState,
  DocumensoError,
  type DocumensoReach,
} from './documenso.ts'
import type { TemplateVariable } from './format.ts'
import { type AssetRef, loadAssets } from './pdf/assets.ts'
import {
  type PdfDocument,
  PdfError,
  type PdfRenderer,
  type RenderedPdf,
} from './pdf/model.ts'
import { renderPdf } from './pdf/render.ts'
import { type BlockValues, fillTemplate, fillTexts } from './pdf/template.ts'
import { reportError } from './report.ts'
import {
  claimDraft,
  getSigningRequest,
  markDraftFailed,
  readDraftEnvelope,
  recoverCompletedDraft,
  SIGNED_PDF_MAX_BYTES,
  signingCredentials,
  SigningFailure,
  STALE_SEND_MS,
  storeSystemFile,
  type SyncContext,
} from './signing-events.ts'

export { STALE_SEND_MS }
/**
 * The deadline of a send's Documenso calls, from its claim: under the edge
 * idle timeout (150 s) and well under `STALE_SEND_MS`.
 */
export const SEND_TIMEOUT_MS = 120_000
/** Each cleanup cancel's own timeout (independent of the send's deadline). */
export const CANCEL_TIMEOUT_MS = 20_000
/** The answer to a second send while one is under way (409). */
export const SEND_IN_PROGRESS_MESSAGE = 'Un envoi est déjà en cours.'
const FN = 'signing'
const DAY_MS = 86_400_000
/** The asset keys a template may use, and where `get_signing_context` puts them. */
const ASSET_KEYS = ['logo', 'signature'] as const

/** One signer of a request; `order` starts at 1. */
export interface RequestSigner {
  role: 'professional' | 'clinic' | 'client'
  name: string
  email: string
  order: number
}

/** What a module asks to have signed. */
export interface CreateSignatureRequestInput {
  orgId: string
  moduleKey: string
  /** `<module>.<name>`; `core.signing_test` for the built-in test document. */
  purpose: string
  /** The published version to render; null only for the test document. */
  templateVersionId: string | null
  /** The record the request is about (its timeline). */
  subject: { type: string; id: string }
  /** Shown in the timeline and Documenso; may name the person (redacted from the audit log). */
  title: string
  viewPermission: string
  /** Template values; `clinic.*` comes from the clinic's identity. */
  values: Record<string, unknown>
  /**
   * Blocks for the template's block placeholders, by variable path (P4-433:
   * a professional's Annexe A tables). Built by the module from its own
   * data, never from a request body.
   */
  blocks?: BlockValues
  signers: RequestSigner[]
  /** One per user action (a double click returns the same request). */
  idempotencyKey: string
  sentBy: string | null
  /**
   * Signed in the app, not from an email (P4-488): the envelope is created
   * with `distributionMethod: 'NONE'` and this redirect after signing, and
   * the result carries each signer's signing token (`links`). Absent: the
   * signers are emailed.
   */
  manual?: { redirectUrl: string }
  /** Only the built-in test document: already filled, with its invitation. */
  document?: PdfDocument
  email?: { subject: string; message: string }
}

/** The outcome; a thrown `SigningFailure` is an internal error (500). */
export type CreateSignatureRequestResult =
  | {
    ok: true
    requestId: string
    existing: boolean
    /**
     * `manual` only, for a request sent by this call: each signer's signing
     * token by role. A credential: handed to its signer once, never stored,
     * logged or reported.
     */
    links?: { role: string; token: string }[]
  }
  | {
    ok: false
    code:
      | 'not_configured'
      | 'module_disabled'
      | 'provider_error'
    requestId: string | null
  }
  | {
    ok: false
    code: 'missing_variable'
    requestId: null
    /** The template variable without a value (its path and French label). */
    variable: { path: string; label: string } | null
  }
  | { ok: false; code: 'invalid_request'; message: string; requestId: null }
  | {
    ok: false
    code: 'send_in_progress'
    message: string
    requestId: string
  }

/**
 * What creating a request needs; `renderer` defaults to pdfmake. No caller
 * signal on purpose: the send outlives the caller's connection (module
 * comment).
 */
export interface SigningDeps {
  /** A service-role client. */
  client: SupabaseClient
  fetch: typeof fetch
  /** Where Documenso requests may go (`documensoReach`, P3-34). */
  reach: DocumensoReach
  now: () => Date
  renderer?: PdfRenderer
}

const assetSchema = z.object({
  bucket: z.string(),
  object_path: z.string(),
}).nullable()

const contextSchema = z.object({
  module_enabled: z.boolean(),
  timezone: z.string(),
  settings: z.object({
    base_url: z.string().nullable(),
    expiry_days: z.number().int().positive(),
  }),
  version: z.object({
    body: z.unknown(),
    variables: z.array(z.custom<TemplateVariable>()),
    email_subject: z.string().nullable(),
    email_message: z.string().nullable(),
  }).nullable(),
  clinic: z.record(z.string(), z.unknown()),
  logo: assetSchema,
  signature: assetSchema,
})

type SigningContext = z.infer<typeof contextSchema>

const createdSchema = z.object({
  id: z.string(),
  existing: z.boolean(),
  status: z.string(),
  last_error: z.string().nullable(),
})

const pdfRenderer: PdfRenderer = { render: renderPdf }

/** The document to render and the invitation, or the fill failure. */
function prepareDocument(
  input: CreateSignatureRequestInput,
  context: SigningContext,
):
  | {
    ok: true
    document: PdfDocument
    email: { subject: string; message: string }
  }
  | { ok: false; code: string; path?: string } {
  if (input.document) {
    return {
      ok: true,
      document: input.document,
      email: input.email ?? { subject: input.title, message: '' },
    }
  }
  const version = context.version
  if (!version) return { ok: false, code: 'no_template_version' }
  // The clinic's identity wins: a module never supplies it.
  const values = { ...input.values, clinic: context.clinic }
  const body = fillTemplate(
    version.body as PdfDocument,
    version.variables,
    values,
    context.timezone,
    input.blocks,
  )
  const email = fillTexts(
    {
      subject: version.email_subject ?? input.title,
      message: version.email_message ?? '',
    },
    version.variables,
    values,
    context.timezone,
    input.blocks,
  )
  if (!body.ok) {
    return {
      ok: false,
      code: body.code,
      path: 'path' in body ? body.path : undefined,
    }
  }
  if (!email.ok) {
    return {
      ok: false,
      code: email.code,
      path: 'path' in email ? email.path : undefined,
    }
  }
  return { ok: true, document: body.document, email: email.texts }
}

/** The images the document uses, from the context's logo and signature. */
function assetRefs(doc: PdfDocument, context: SigningContext): AssetRef[] {
  const used = new Set(
    doc.blocks.flatMap((b) => b.type === 'image' ? [b.assetKey] : []),
  )
  return ASSET_KEYS.flatMap((key) => {
    const ref = context[key]
    return used.has(key) && ref
      ? [{ key, bucket: ref.bucket, path: ref.object_path }]
      : []
  })
}

/**
 * Creates (or resumes) a signature request and sends it through Documenso
 * (module comment). Throws `SigningFailure` for an internal error.
 */
export async function createSignatureRequest(
  deps: SigningDeps,
  input: CreateSignatureRequestInput,
): Promise<CreateSignatureRequestResult> {
  const { client } = deps
  const [contextResult, credentials] = await Promise.all([
    client.rpc('get_signing_context', {
      p_org_id: input.orgId,
      p_template_version_id: input.templateVersionId,
    }),
    signingCredentials(client, input.orgId).catch(() => null),
  ])
  const parsed = contextSchema.safeParse(contextResult.data)
  if (contextResult.error || !credentials || !parsed.success) {
    throw new SigningFailure('signing_context_failed')
  }
  // The address and the expiry come with the key (one snapshot), not from
  // the context read beside it.
  const context: SigningContext = {
    ...parsed.data,
    settings: {
      base_url: credentials.base_url,
      expiry_days: credentials.expiry_days,
    },
  }
  if (!context.module_enabled) {
    return { ok: false, code: 'module_disabled', requestId: null }
  }
  const apiKey = credentials.api_key ?? ''
  if (!context.settings.base_url || !apiKey) {
    return { ok: false, code: 'not_configured', requestId: null }
  }
  const prepared = prepareDocument(input, context)
  if (!prepared.ok) {
    if (prepared.code === 'missing_variable') {
      const variable = context.version?.variables.find((v) =>
        v.path === prepared.path
      )
      return {
        ok: false,
        code: 'missing_variable',
        requestId: null,
        variable: variable
          ? { path: variable.path, label: variable.label }
          : null,
      }
    }
    throw new SigningFailure(prepared.code)
  }

  const signers = [...input.signers].sort((a, b) => a.order - b.order)
  const created = await client.rpc('create_signature_request', {
    p: {
      org_id: input.orgId,
      module_key: input.moduleKey,
      purpose: input.purpose,
      template_version_id: input.templateVersionId,
      subject_type: input.subject.type,
      subject_id: input.subject.id,
      title: input.title,
      view_permission: input.viewPermission,
      idempotency_key: input.idempotencyKey,
      sent_by: input.sentBy,
      signers,
    },
  })
  if (created.error?.code === 'P0001') {
    return {
      ok: false,
      code: 'invalid_request',
      message: created.error.message,
      requestId: null,
    }
  }
  const row = createdSchema.safeParse(
    Array.isArray(created.data) ? created.data[0] : null,
  )
  if (created.error || !row.success) {
    throw new SigningFailure('create_request_failed')
  }
  const request = row.data
  if (request.existing && request.status !== 'draft') {
    return { ok: true, requestId: request.id, existing: true }
  }
  if (request.existing && request.last_error === 'abandoned') {
    return { ok: false, code: 'provider_error', requestId: request.id }
  }
  if (!(await claimDraft(client, input.orgId, request.id))) {
    return {
      ok: false,
      code: 'send_in_progress',
      message: SEND_IN_PROGRESS_MESSAGE,
      requestId: request.id,
    }
  }

  // The send's own deadline, from the claim (never the caller's signal).
  const signal = AbortSignal.timeout(SEND_TIMEOUT_MS)
  const baseUrl = context.settings.base_url!
  const plan: SendPlan = {
    requestId: request.id,
    existing: request.existing,
    context,
    document: prepared.document,
    email: prepared.email,
    signers,
    documenso: documensoClient(baseUrl, apiKey, deps.fetch, {
      signal,
      maxDownloadBytes: SIGNED_PDF_MAX_BYTES,
      reach: deps.reach,
    }),
    cleanup: documensoClient(baseUrl, apiKey, deps.fetch, {
      timeoutMs: CANCEL_TIMEOUT_MS,
      reach: deps.reach,
    }),
    markFailed: (code, ids) =>
      markDraftFailed(
        client,
        { fn: FN, orgId: input.orgId, fetch: deps.fetch },
        request.id,
        code,
        ids,
      ),
  }
  if (request.existing) {
    const settled = await settleEarlierEnvelope(deps, input, plan)
    if (settled) return settled
  }
  return await send(deps, input, plan)
}

interface SendPlan {
  requestId: string
  existing: boolean
  context: SigningContext
  document: PdfDocument
  email: { subject: string; message: string }
  signers: RequestSigner[]
  /** Bound to the send's deadline. */
  documenso: DocumensoClient
  /** For cleanup cancels: its own timeout only. */
  cleanup: DocumensoClient
  /** Marks the draft failed (releases the claim). */
  markFailed: (
    code: string,
    ids?: { envelopeId?: string | null },
  ) => Promise<void>
}

/**
 * Step 3c of the module comment: null to send again, or the answer when the
 * earlier envelope ends the re-send (recovered, or not cancelled).
 */
async function settleEarlierEnvelope(
  deps: SigningDeps,
  input: CreateSignatureRequestInput,
  plan: SendPlan,
): Promise<CreateSignatureRequestResult | null> {
  const { client } = deps
  const { requestId, documenso } = plan
  // Read under the claim: another attempt may have changed it since.
  const current = await getSigningRequest(client, input.orgId, requestId)
  const envelopeId = current?.envelope_id ?? null
  if (!current || !envelopeId) return null
  const providerFailure = async (code: string, error: unknown) => {
    await plan.markFailed(code)
    const refused = error instanceof DocumensoError &&
      error.code === 'not_configured'
    return {
      ok: false as const,
      code: refused ? 'not_configured' as const : 'provider_error' as const,
      requestId,
    }
  }

  let state: DocumensoEnvelopeState | null
  try {
    // Null when gone at Documenso (deleted when an earlier send failed), or
    // not this request's own envelope (reported): either way, send again.
    state = await readDraftEnvelope(
      { fn: FN, orgId: input.orgId, fetch: deps.fetch },
      documenso,
      requestId,
      envelopeId,
    )
  } catch (error) {
    return await providerFailure('previous_read_failed', error)
  }

  if (state?.status === 'COMPLETED') {
    // Signed there: recover it, never send a second contract.
    const ctx: SyncContext = {
      client,
      orgId: input.orgId,
      signing: { documenso, expiryDays: plan.context.settings.expiry_days },
      now: deps.now,
      fn: FN,
      fetch: deps.fetch,
    }
    try {
      const outcome = await recoverCompletedDraft(
        ctx,
        current,
        envelopeId,
        state,
      )
      return outcome === 'signed'
        ? { ok: true, requestId, existing: true }
        : { ok: false, code: 'provider_error', requestId }
    } catch (error) {
      const raw = (error as { code?: unknown }).code
      const code = error instanceof DocumensoError
        ? 'provider_unavailable'
        : typeof raw === 'string'
        ? raw
        : 'recover_failed'
      const after = await getSigningRequest(client, input.orgId, requestId)
        .catch(() => null)
      if (after && after.status !== 'draft') {
        // Recovered (completion stamped); only the signed PDF is missing,
        // which the reconcile downloads.
        await reportError({
          fn: FN,
          code: 'signing_recover_incomplete',
          ids: { org_id: input.orgId, signature_request_id: requestId },
        }, deps.fetch)
        return { ok: true, requestId, existing: true }
      }
      await plan.markFailed(code)
      if (error instanceof DocumensoError) {
        return await providerFailure(code, error)
      }
      throw new SigningFailure(code, requestId)
    }
  }
  if (state?.status === 'DRAFT' || state?.status === 'PENDING') {
    try {
      // Documenso cancels only a pending envelope: a draft is deleted (E-8).
      await documenso.cancel(envelopeId, { draft: state.status === 'DRAFT' })
    } catch (error) {
      // Never two live contracts: the re-send stops here, retryable.
      return await providerFailure('previous_cancel_failed', error)
    }
  }
  return null
}

/** Steps 4 to 7 of the module comment. */
async function send(
  deps: SigningDeps,
  input: CreateSignatureRequestInput,
  plan: SendPlan,
): Promise<CreateSignatureRequestResult> {
  const { client } = deps
  const { requestId, context, documenso, markFailed } = plan

  let rendered: RenderedPdf
  try {
    const assets = await loadAssets(client, assetRefs(plan.document, context))
    rendered = await (deps.renderer ?? pdfRenderer).render(
      plan.document,
      assets,
    )
  } catch (error) {
    const code = error instanceof PdfError ? error.code : 'render_failed'
    await markFailed(code)
    if (code === 'missing_asset') {
      return { ok: false, code: 'not_configured', requestId }
    }
    throw new SigningFailure(code, requestId)
  }

  let sourceFileId: string
  try {
    sourceFileId = await storeSystemFile(client, {
      orgId: input.orgId,
      bucket: 'documents',
      purpose: 'signing_source',
      requestId,
      viewPermission: input.viewPermission,
      name: 'Document à signer.pdf',
      bytes: rendered.bytes,
    }, { register: 'source_register_failed', upload: 'source_upload_failed' })
  } catch (error) {
    await markFailed('storage_failed')
    throw new SigningFailure((error as SigningFailure).code, requestId)
  }

  let envelopeId: string | null = null
  // Set just before `distribute`: from then on the envelope may be pending
  // (a timed-out distribute can still have sent it), so it is cancelled with
  // the fallback; before, it is a draft and deleted (E-8).
  let distributing = false
  const cancelAndMark = async (code: string) => {
    if (envelopeId) {
      try {
        await plan.cleanup.cancel(envelopeId, { draft: !distributing })
      } catch {
        // Best effort: the reconcile reads the draft's envelope and settles it.
      }
    }
    await markFailed(code, { envelopeId })
  }

  let recipients: { role: string; recipient_id: string }[]
  let links: { role: string; token: string }[] | undefined
  try {
    const created = await documenso.createEnvelope(rendered.bytes, {
      title: input.title,
      externalId: requestId,
      recipients: plan.signers.map((s) => ({
        email: s.email,
        name: s.name,
        role: 'SIGNER' as const,
        signingOrder: s.order,
        // Each box to its role's recipient; one whose role has no signer
        // here is left out.
        fields: rendered.fields.filter((f) => f.role === s.role),
      })),
      meta: {
        subject: plan.email.subject,
        message: plan.email.message,
        language: 'fr',
        distributionMethod: input.manual ? 'NONE' : 'EMAIL',
        ...(input.manual && { redirectUrl: input.manual.redirectUrl }),
        signingOrder: plan.signers.length > 1 ? 'SEQUENTIAL' : 'PARALLEL',
        timezone: context.timezone,
        expiryDays: context.settings.expiry_days,
      },
    })
    envelopeId = created.envelopeId
    // createEnvelope answers the recipients in the order they were sent.
    recipients = plan.signers.map((s, i) => ({
      role: s.role,
      recipient_id: created.recipients[i].id,
    }))
    distributing = true
    if (input.manual) {
      const tokens = await documenso.distributeForSigning(envelopeId)
      links = recipients.flatMap((r) => {
        const token = tokens.find((x) => x.recipientId === r.recipient_id)
          ?.token
        return token ? [{ role: r.role, token }] : []
      })
    } else {
      await documenso.distribute(envelopeId)
    }
  } catch (error) {
    if (error instanceof DocumensoError) {
      envelopeId ??= error.envelopeId
      const refused = error.code === 'not_configured'
      // Refused before any request (subject or message too long, two signers
      // with one address): its own code, not an outage.
      await cancelAndMark(
        refused
          ? 'provider_not_configured'
          : error.code === 'invalid_request'
          ? 'provider_invalid_request'
          : 'provider_unavailable',
      )
      return {
        ok: false,
        code: refused ? 'not_configured' : 'provider_error',
        requestId,
      }
    }
    await cancelAndMark('internal_error')
    throw new SigningFailure('internal_error', requestId)
  }

  const expiresAt = new Date(
    deps.now().getTime() + context.settings.expiry_days * DAY_MS,
  )
  const sent = await client.rpc('mark_signature_request_sent', {
    p_id: requestId,
    p_envelope_id: envelopeId,
    p_source_file_id: sourceFileId,
    p_signer_recipients: recipients,
    p_expires_at: expiresAt.toISOString(),
    p_page_count: rendered.pageCount,
  })
  if (sent.error) {
    await cancelAndMark('mark_sent_failed')
    throw new SigningFailure('mark_sent_failed', requestId)
  }
  return {
    ok: true,
    requestId,
    existing: plan.existing,
    ...(links && { links }),
  }
}
