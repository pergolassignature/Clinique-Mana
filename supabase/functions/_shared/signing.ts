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
 * 1. `get_signing_context` ∥ `get_org_secret('documenso_api_key')`: a disabled
 *    module → `module_disabled`; no URL or key → `not_configured`; no row.
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
 * 3c. A re-sent draft with a Documenso document settles that earlier
 *    document first (`get_signing_request` read after the claim, then
 *    Documenso): COMPLETED → recovered (`recoverCompletedDraft`: the request
 *    becomes signed) and nothing is sent again; DRAFT or PENDING → cancelled
 *    (a failed cancel ends the re-send: marked `previous_cancel_failed`,
 *    `provider_error`, retryable); CANCELLED, REJECTED or gone (404) → sent
 *    again. The new document then replaces it (the earlier id is superseded).
 * 4. The images (logo, signature) the document uses, in parallel → render.
 * 5. `register_system_file` (`documents`, `signing_source`, the request's
 *    view permission) → upload (`upsert: false`); a failed upload discards
 *    the row.
 * 6. Documenso: `createDocument` (`externalId` = the request id; recipients
 *    in signing order; French; the expiry) → `addFields` (each field to its
 *    role's recipient; a box whose role has no signer here is left out) →
 *    `distribute`.
 * 7. `mark_signature_request_sent` (recipients keyed by role, expiry = now +
 *    `expiry_days`).
 *
 * A failure from step 4 on marks the draft (`mark_signature_request_failed`
 * with a code, and the Documenso ids once known), which releases the claim,
 * so a retry with the same key sends again at once. From step 6 on, the
 * document is cancelled first, best effort (by id while a draft, by
 * envelope once distributed). Documenso failures answer `provider_error`
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
  type DocumensoDocumentState,
  DocumensoError,
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
import { fillTemplate, fillTexts } from './pdf/template.ts'
import { reportError } from './report.ts'
import {
  claimDraft,
  getSigningRequest,
  markDraftFailed,
  recoverCompletedDraft,
  SIGNED_PDF_MAX_BYTES,
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
  signers: RequestSigner[]
  /** One per user action (a double click returns the same request). */
  idempotencyKey: string
  sentBy: string | null
  /** Only the built-in test document: already filled, with its invitation. */
  document?: PdfDocument
  email?: { subject: string; message: string }
}

/** The outcome; a thrown `SigningFailure` is an internal error (500). */
export type CreateSignatureRequestResult =
  | { ok: true; requestId: string; existing: boolean }
  | {
    ok: false
    code:
      | 'not_configured'
      | 'module_disabled'
      | 'missing_variable'
      | 'provider_error'
    requestId: string | null
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
  | { ok: false; code: string } {
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
  )
  const email = fillTexts(
    {
      subject: version.email_subject ?? input.title,
      message: version.email_message ?? '',
    },
    version.variables,
    values,
    context.timezone,
  )
  if (!body.ok) return { ok: false, code: body.code }
  if (!email.ok) return { ok: false, code: email.code }
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
  const [contextResult, secret] = await Promise.all([
    client.rpc('get_signing_context', {
      p_org_id: input.orgId,
      p_template_version_id: input.templateVersionId,
    }),
    client.rpc('get_org_secret', {
      p_org_id: input.orgId,
      p_key: 'documenso_api_key',
    }),
  ])
  const parsed = contextSchema.safeParse(contextResult.data)
  if (contextResult.error || secret.error || !parsed.success) {
    throw new SigningFailure('signing_context_failed')
  }
  const context = parsed.data
  if (!context.module_enabled) {
    return { ok: false, code: 'module_disabled', requestId: null }
  }
  const apiKey = typeof secret.data === 'string' ? secret.data : ''
  if (!context.settings.base_url || !apiKey) {
    return { ok: false, code: 'not_configured', requestId: null }
  }
  const prepared = prepareDocument(input, context)
  if (!prepared.ok) {
    if (prepared.code === 'missing_variable') {
      return { ok: false, code: 'missing_variable', requestId: null }
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
    }),
    cleanup: documensoClient(baseUrl, apiKey, deps.fetch, {
      timeoutMs: CANCEL_TIMEOUT_MS,
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
    const settled = await settleEarlierDocument(deps, input, plan)
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
    ids?: { documentId?: string | null; envelopeId?: string | null },
  ) => Promise<void>
}

/**
 * Step 3c of the module comment: null to send again, or the answer when the
 * earlier document ends the re-send (recovered, or not cancelled).
 */
async function settleEarlierDocument(
  deps: SigningDeps,
  input: CreateSignatureRequestInput,
  plan: SendPlan,
): Promise<CreateSignatureRequestResult | null> {
  const { client } = deps
  const { requestId, documenso } = plan
  // Read under the claim: another attempt may have changed it since.
  const current = await getSigningRequest(client, input.orgId, requestId)
  const documentId = current?.documenso_document_id ?? null
  if (!documentId) return null
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

  let state: DocumensoDocumentState | null = null
  try {
    state = await documenso.get(documentId)
  } catch (error) {
    // Gone at Documenso (deleted when an earlier send failed): send again.
    if (!(error instanceof DocumensoError && error.status === 404)) {
      return await providerFailure('previous_read_failed', error)
    }
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
        { id: requestId },
        documentId,
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
      // Documenso cancels only a distributed envelope; a draft goes by its id.
      await documenso.cancel(documentId, {
        envelopeId: state.status === 'PENDING' ? current!.envelope_id : null,
      })
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

  let documentId: string | null = null
  let envelopeId: string | null = null
  let distributed = false
  const cancelAndMark = async (code: string) => {
    if (documentId) {
      try {
        await plan.cleanup.cancel(documentId, {
          envelopeId: distributed ? envelopeId : null,
        })
      } catch {
        // Best effort: the reconcile reads the draft's document and settles it.
      }
    }
    await markFailed(code, { documentId, envelopeId })
  }

  let recipients: { role: string; recipient_id: string }[]
  try {
    const created = await documenso.createDocument(rendered.bytes, {
      title: input.title,
      externalId: requestId,
      recipients: plan.signers.map((s) => ({
        email: s.email,
        name: s.name,
        role: 'SIGNER' as const,
        signingOrder: s.order,
      })),
      meta: {
        subject: plan.email.subject,
        message: plan.email.message,
        language: 'fr',
        distributionMethod: 'EMAIL',
        signingOrder: plan.signers.length > 1 ? 'SEQUENTIAL' : 'PARALLEL',
        timezone: context.timezone,
        expiryDays: context.settings.expiry_days,
      },
    })
    documentId = created.documentId
    envelopeId = created.envelopeId
    // createDocument answers the recipients in the order they were sent.
    recipients = plan.signers.map((s, i) => ({
      role: s.role,
      recipient_id: created.recipients[i].id,
    }))
    const byRole = new Map(recipients.map((r) => [r.role, r.recipient_id]))
    await documenso.addFields(
      documentId,
      rendered.fields.flatMap((f) => {
        const recipientId = byRole.get(f.role)
        return recipientId ? [{ ...f, recipientId }] : []
      }),
    )
    await documenso.distribute(documentId)
    distributed = true
  } catch (error) {
    if (error instanceof DocumensoError) {
      documentId ??= error.documentId
      const refused = error.code === 'not_configured'
      await cancelAndMark(
        refused ? 'provider_not_configured' : 'provider_unavailable',
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
    p_documenso_document_id: documentId,
    p_envelope_id: envelopeId,
    p_source_file_id: sourceFileId,
    p_signer_recipients: recipients,
    p_expires_at: expiresAt.toISOString(),
  })
  if (sent.error) {
    await cancelAndMark('mark_sent_failed')
    throw new SigningFailure('mark_sent_failed', requestId)
  }
  return { ok: true, requestId, existing: plan.existing }
}
