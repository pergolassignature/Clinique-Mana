/**
 * `billing-documents` (Facturation F2): the PDFs of the invoices, credit
 * notes, receipts and statements, and their emails to the payer. This
 * function renders (`_shared/pdf/render.ts`), so it carries pdfmake (ADR
 * 0008).
 *
 * **Job mode** (a request carrying `X-Job-Signature`, `billing.documents`,
 * every 5 minutes): `runJob` verifies the signature, then `deliverOrg` per
 * clinic.
 *
 * **User mode** (CORS; `POST` only; `verifyAuth` with module `billing`):
 * - `{ action: 'deliver' }` (`billing.manage`, right after « Envoyer »,
 *   « Enregistrer le paiement », « Relevé »): one hit on
 *   `LIMITS.billingDeliverUser`, then `deliverOrg` for the caller's clinic.
 *   200 `{ done, failed }`.
 * - `{ action: 'preview', kind, id }` (`billing.view`): one hit on
 *   `LIMITS.billingPreviewUser`, `get_billing_document` with the **caller's**
 *   client (its permission check; a draft invoice too), the logo, the render.
 *   200 `{ pdf, filename }` (base64, `no-store`); 404 when the document is
 *   not the caller's clinic's.
 *
 * `deliverOrg` (up to 25 deliveries a run):
 * 1. `requireModuleForOrg` (`billing`).
 * 2. `billing_deliveries_for_service` claims the due deliveries.
 * 3. Each: `billing_document_for_service` (null: gone, skipped); the stored
 *    PDF downloaded, else rendered (the logo when it loads) and stored
 *    (`register_system_file`, purpose `billing_document`, subject the
 *    document; a failed upload discards the row); then the email when the
 *    database names one (`billing.<kind>`, `_en` in English, the PDF
 *    attached; the template's module reserved → set aside `reserved`, CC-14);
 *    `finish_billing_delivery_for_service` with the outcome: a failure is a
 *    code, tried again by the database (10, 20 minutes), failed at the
 *    third try.
 *
 * Nothing logs an address, a name or an amount: reports carry ids.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { type SendResult, sendTemplatedEmail } from '../_shared/email/send.ts'
import { readJson } from '../_shared/http.ts'
import { runJob } from '../_shared/jobs.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import { loadAssets } from '../_shared/pdf/assets.ts'
import type { PdfAssets } from '../_shared/pdf/model.ts'
import { renderPdf } from '../_shared/pdf/render.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { sha256Hex, sniff } from '../_shared/storage.ts'
import {
  type BillingDocument,
  billingDocumentSchema,
  billingEmail,
  billingPdf,
  documentLanguage,
  documentTitle,
} from './document.ts'

const FN = 'billing-documents'
export const JOB_KEY = 'billing.documents'
/** Deliveries per run and clinic. */
export const BATCH_LIMIT = 25
/** A run stops claiming after this (the job's per-org budget is 60 s). */
const SOFT_DEADLINE_MS = 45_000

const KIND = z.enum(['invoice', 'credit_note', 'receipt', 'statement'])

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('deliver') }),
  z.strictObject({ action: z.literal('preview'), kind: KIND, id: z.guid() }),
])

const fileRef = z.object({ bucket: z.string(), object_path: z.string() })

const deliverySchema = z.object({
  delivery_id: z.string(),
  kind: KIND,
  document_id: z.string(),
  explicit: z.boolean(),
  document: z.unknown(),
  stored: fileRef.extend({ file_id: z.string() }).nullable(),
  logo: fileRef.nullable(),
  email: z.object({
    to: z.string(),
    first_name: z.string().nullable(),
    language: z.string().nullable(),
  }).nullable(),
  skip_reason: z.enum(['not_requested', 'no_email', 'reserved']).nullable(),
})

const registeredSchema = z.object({
  file_id: z.string(),
  object_path: z.string(),
})

/** A failure of one delivery, by code (tried again by the database). */
class DeliveryFailure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

/** The handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.headers.has('X-Job-Signature')) {
      return await runJob(
        deps,
        req,
        JOB_KEY,
        async (orgId, client, signal) => {
          const result = await deliverOrg(deps, orgId, client, signal)
          return `done=${result.done} failed=${result.failed}`
        },
      )
    }
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { module: 'billing', permission: 'billing.view' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id

    if (input.action === 'deliver') {
      if (!auth.access.permissions.includes('billing.manage')) {
        return errorResponse('forbidden', 'Permission denied', 403, req)
      }
      const limited = limitResponse(
        await consume(service, LIMITS.billingDeliverUser, [auth.user.id]),
        req,
      )
      if (limited) return limited
      try {
        const result = await deliverOrg(
          deps,
          orgId,
          service,
          new AbortController().signal,
        )
        return jsonResponse(result, 200, req)
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'deliver_failed'
        await reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)
        return errorResponse('internal', 'Delivery failed', 500, req)
      }
    }

    const limited = limitResponse(
      await consume(service, LIMITS.billingPreviewUser, [auth.user.id]),
      req,
    )
    if (limited) return limited
    const { data, error } = await auth.client.rpc('get_billing_document', {
      p_kind: input.kind,
      p_id: input.id,
    })
    if (error) {
      if (error.code === '42501') {
        return errorResponse('forbidden', 'Permission denied', 403, req)
      }
      await reportError(
        {
          fn: FN,
          code: 'preview_read_failed',
          ids: { org_id: orgId, document_id: input.id },
        },
        deps.fetch,
      )
      return errorResponse('internal', 'Preview failed', 500, req)
    }
    if (data === null || (data as { document?: unknown }).document === null) {
      return errorResponse('not_found', 'Document not found', 404, req)
    }
    const answerSchema = z.object({
      document: z.unknown(),
      logo: fileRef.nullable(),
    })
    const shape = answerSchema.safeParse(data)
    const parsed = billingDocumentSchema.safeParse(
      shape.success ? shape.data.document : null,
    )
    if (!shape.success || !parsed.success) {
      await reportError(
        {
          fn: FN,
          code: 'preview_invalid',
          ids: { org_id: orgId, document_id: input.id },
        },
        deps.fetch,
      )
      return errorResponse('internal', 'Preview failed', 500, req)
    }
    try {
      const assets = await logoAssets(service, shape.data.logo)
      const pdf = await renderPdf(
        billingPdf(parsed.data, { logo: 'logo' in assets }),
        assets,
      )
      const answer = jsonResponse(
        {
          pdf: toBase64(pdf.bytes),
          filename: `${
            documentTitle(parsed.data, documentLanguage(parsed.data))
          }.pdf`,
        },
        200,
        req,
      )
      answer.headers.set('Cache-Control', 'no-store')
      return answer
    } catch {
      await reportError(
        {
          fn: FN,
          code: 'preview_render_failed',
          ids: { org_id: orgId, document_id: input.id },
        },
        deps.fetch,
      )
      return errorResponse('internal', 'Preview failed', 500, req)
    }
  }
}

/** The logo as an asset, or none when it does not load (the PDF goes without it). */
async function logoAssets(
  service: SupabaseClient,
  logo: z.infer<typeof fileRef> | null,
): Promise<PdfAssets> {
  if (!logo) return {}
  try {
    return await loadAssets(service, [{
      key: 'logo',
      bucket: logo.bucket,
      path: logo.object_path,
    }])
  } catch {
    return {}
  }
}

/** Base64 in chunks (a spread of the whole PDF would overflow the stack). */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** One clinic's due deliveries; exported for the tests. */
export async function deliverOrg(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<{ done: number; failed: number }> {
  if (await requireModuleForOrg(client, orgId, 'billing')) {
    throw Object.assign(new Error('module_disabled'), {
      code: 'module_disabled',
    })
  }
  const started = deps.now().getTime()
  const { data, error } = await client.rpc('billing_deliveries_for_service', {
    p_org_id: orgId,
    p_limit: BATCH_LIMIT,
  })
  if (error) {
    throw Object.assign(new Error('claim_failed'), { code: 'claim_failed' })
  }
  const ids = z.array(z.string()).max(100).safeParse(data)
  if (!ids.success) {
    throw Object.assign(new Error('claim_invalid'), { code: 'claim_invalid' })
  }
  let done = 0
  let failed = 0
  for (const deliveryId of ids.data) {
    // Claimed but not started: the database takes them again after 10 minutes.
    if (signal.aborted || deps.now().getTime() - started > SOFT_DEADLINE_MS) {
      break
    }
    const ok = await deliverOne(deps, orgId, client, deliveryId)
    if (ok) done++
    else failed++
  }
  return { done, failed }
}

/** One delivery, start to finish; true when it ended (done), false when it failed. */
async function deliverOne(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  deliveryId: string,
): Promise<boolean> {
  const ids = { org_id: orgId, billing_delivery_id: deliveryId }
  const report = (code: string) =>
    reportError({ fn: FN, code, ids }, deps.fetch)
  const finish = async (outcome: {
    fileId?: string | null
    emailStatus?: 'sent' | 'skipped' | 'failed'
    skipReason?: string | null
    emailLogId?: string | null
    error?: string
  }) => {
    const { error } = await client.rpc('finish_billing_delivery_for_service', {
      p_org_id: orgId,
      p_delivery_id: deliveryId,
      p_file_id: outcome.fileId ?? null,
      p_email_status: outcome.error ? null : outcome.emailStatus,
      p_skip_reason: outcome.skipReason ?? null,
      p_email_log_id: outcome.emailLogId ?? null,
      p_error: outcome.error ?? null,
    })
    if (error) await report('finish_failed')
  }

  const { data: raw, error: readError } = await client.rpc(
    'billing_document_for_service',
    { p_org_id: orgId, p_delivery_id: deliveryId },
  )
  if (readError) {
    await report('document_read_failed')
    await finish({ error: 'document_read_failed' })
    return false
  }
  if (raw === null) return true
  const delivery = deliverySchema.safeParse(raw)
  const document = delivery.success
    ? billingDocumentSchema.safeParse(delivery.data.document)
    : null
  if (!delivery.success || !document?.success) {
    await report('document_invalid')
    await finish({ error: 'document_invalid' })
    return false
  }
  const d = delivery.data
  const doc = document.data

  let bytes: Uint8Array
  let newFileId: string | null = null
  try {
    if (d.stored) {
      bytes = await download(client, d.stored)
    } else {
      const assets = await logoAssets(client, d.logo)
      const pdf = await renderPdf(
        billingPdf(doc, { logo: 'logo' in assets }),
        assets,
      )
      bytes = pdf.bytes
      newFileId = await store(client, orgId, d.kind, d.document_id, doc, bytes)
    }
  } catch (error) {
    const code = error instanceof DeliveryFailure ? error.code : 'render_failed'
    await report(code)
    await finish({ error: code })
    return false
  }

  if (!d.email) {
    await finish({
      fileId: newFileId,
      emailStatus: 'skipped',
      skipReason: d.skip_reason ?? 'not_requested',
    })
    return true
  }

  const email = billingEmail(doc, d.email.first_name ?? doc.payer.name)
  let result: SendResult | null = null
  try {
    result = await sendTemplatedEmail(
      { fn: FN, client, env: deps.env, fetch: deps.fetch },
      {
        orgId,
        templateKey: email.templateKey,
        to: { email: d.email.to, profileId: null },
        subject: { type: d.kind, id: d.document_id },
        values: email.values,
        actionUrl: null,
        sentBy: null,
        explicitResend: d.explicit,
        attachments: [{
          filename: email.filename,
          content: bytes,
          contentType: 'application/pdf',
        }],
      },
    )
  } catch {
    // sendTemplatedEmail reported it.
  }
  if (result?.ok) {
    await finish({
      fileId: newFileId,
      emailStatus: 'sent',
      emailLogId: result.emailLogId,
    })
    return true
  }
  const code = result?.code ?? 'send_failed'
  if (code === 'module_reserved' || code === 'module_disabled') {
    // Core held it (P3-40, CC-14): set aside, never tried again.
    await finish({
      fileId: newFileId,
      emailStatus: 'skipped',
      skipReason: code === 'module_reserved' ? 'reserved' : 'module_disabled',
    })
    return true
  }
  if (code === 'invalid_recipient' || code === 'recipient_not_allowed') {
    await finish({
      fileId: newFileId,
      emailStatus: 'failed',
      emailLogId: result?.emailLogId ?? null,
    })
    return true
  }
  await finish({ fileId: newFileId, error: code })
  return false
}

async function download(
  client: SupabaseClient,
  file: z.infer<typeof fileRef>,
): Promise<Uint8Array> {
  const { data, error } = await client.storage.from(file.bucket).download(
    file.object_path,
  )
  if (error || !data) throw new DeliveryFailure('stored_unavailable')
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (sniff(bytes) !== 'pdf') throw new DeliveryFailure('stored_invalid')
  return bytes
}

/** Registers the PDF and uploads it; a failed upload discards the row. Returns the file id. */
async function store(
  client: SupabaseClient,
  orgId: string,
  kind: z.infer<typeof KIND>,
  documentId: string,
  doc: BillingDocument,
  bytes: Uint8Array,
): Promise<string> {
  const registered = await client.rpc('register_system_file', {
    p_org_id: orgId,
    p_bucket: 'documents',
    p_module_key: 'billing',
    p_purpose: 'billing_document',
    p_subject_type: kind,
    p_subject_id: documentId,
    p_mime_type: 'application/pdf',
    p_size_bytes: bytes.length,
    p_sha256: sha256Hex(bytes),
    p_view_permission: 'billing.view',
    p_original_name: `${documentTitle(doc, documentLanguage(doc))}.pdf`,
  })
  const row = registeredSchema.safeParse(
    Array.isArray(registered.data) ? registered.data[0] : null,
  )
  if (registered.error || !row.success) {
    throw new DeliveryFailure('register_failed')
  }
  const upload = await client.storage.from('documents').upload(
    row.data.object_path,
    bytes,
    { contentType: 'application/pdf', upsert: false },
  )
  if (upload.error) {
    await client.rpc('discard_billing_file_for_service', {
      p_org_id: orgId,
      p_file_id: row.data.file_id,
    })
    throw new DeliveryFailure('upload_failed')
  }
  return row.data.file_id
}
