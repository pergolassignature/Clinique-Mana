/**
 * `billing-payout-invoice` (FPay, « Générer ma facture »): renders the
 * professional's invoice to the clinic from her validated payroll period and
 * attaches it to the period, as an uploaded one would be. This function
 * renders (`_shared/pdf/render.ts`), so it carries pdfmake (ADR 0008).
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `billing` and
 *    `billing.self` (the administration generating for her holds it too; the
 *    database checks the period is hers or the caller holds `billing.payroll`).
 * 2. Body `{ period_id, number, issued_on? }`, strict: `number` is her own
 *    invoice number (1–40 characters, none a file name refuses: it names the
 *    file), `issued_on` a real `yyyy-MM-dd` date (default: the clinic's
 *    today).
 * 3. One hit on `LIMITS.billingPayoutInvoiceUser` (20 an hour per caller).
 * 4. `prepare_professional_invoice` with the **service** client, `p_actor` =
 *    the caller: the period (validated), its lines (client file numbers, never
 *    names), her facts and the clinic's identity (P0001 refusals → 400).
 * 5. `renderPdf`, then `register_system_file` (purpose
 *    `billing_professional_invoice`, subject the period, view
 *    `billing.payroll`), the upload, and `record_generated_professional_invoice`
 *    (which makes her the file's owner). A file left behind by a failed
 *    upload or record stays staged and `storage-cleanup` removes it the
 *    next day (`retain_days` 1). More than 400 lines: a 400 refusal
 *    (« téléversez votre facture »), the PDF model's cap.
 * 6. 200 `{ invoice_id, file_id }`.
 *
 * Status codes: 200; 400 `invalid_request` (body, or the database's French
 * refusal); 401 / 403 / 503 from `verifyAuth`; 403 (42501); 405; 413; 429;
 * 500 `internal` (reported with the org and period ids only).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  refusalResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { readJson } from '../_shared/http.ts'
import { renderPdf } from '../_shared/pdf/render.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { forbiddenNameChar } from '../_shared/file-name.ts'
import { reportError } from '../_shared/report.ts'
import { sha256Hex } from '../_shared/storage.ts'
import { payoutInvoiceDocument, preparedSchema } from './document.ts'

const FN = 'billing-payout-invoice'
/** The PDF model's cap on table rows in a document (`MAX_DOCUMENT_TABLE_ROWS`). */
const MAX_LINES = 400

const bodySchema = z.strictObject({
  period_id: z.guid(),
  number: z.string().trim().min(1).max(40).refine(
    (value) => ![...value].some(forbiddenNameChar),
  ),
  issued_on: z.iso.date().optional(),
})

const registeredSchema = z.object({
  file_id: z.guid(),
  object_path: z.string().min(1),
})

interface RpcError {
  code?: string
  message?: string
}

/** A P0001 refusal is shown as written; 42501 is a 403; anything else is internal. */
function rpcFailure(error: RpcError, req: Request): Response | null {
  if (error.code === 'P0001' && error.message) {
    return refusalResponse(error.message, req)
  }
  if (error.code === '42501') {
    return errorResponse('forbidden', 'Forbidden', 403, req)
  }
  return null
}

/** The invoice generator; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {
      module: 'billing',
      permission: 'billing.self',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const { access, user } = auth
    const ids = { org_id: access.org_id, payout_period_id: input.period_id }

    const limited = limitResponse(
      await consume(service, LIMITS.billingPayoutInvoiceUser, [
        access.org_id,
        user.id,
      ]),
      req,
    )
    if (limited) return limited

    const prepared = await service.rpc('prepare_professional_invoice', {
      p_period_id: input.period_id,
      p_actor: user.id,
    })
    if (prepared.error) {
      const failure = rpcFailure(prepared.error, req)
      if (failure) return failure
      await reportError({ fn: FN, code: 'prepare_failed', ids }, deps.fetch)
      return errorResponse(
        'internal',
        'The invoice could not be generated',
        500,
        req,
      )
    }
    const invoice = preparedSchema.safeParse(prepared.data)
    if (!invoice.success || invoice.data.org_id !== access.org_id) {
      await reportError({ fn: FN, code: 'prepare_invalid', ids }, deps.fetch)
      return errorResponse(
        'internal',
        'The invoice could not be generated',
        500,
        req,
      )
    }
    if (invoice.data.lines.length > MAX_LINES) {
      return refusalResponse(
        'Ce sommaire compte trop de lignes pour générer la facture : téléversez la vôtre.',
        req,
      )
    }
    const issuedOn = input.issued_on ?? invoice.data.today

    let bytes: Uint8Array
    try {
      bytes = (await renderPdf(
        payoutInvoiceDocument(invoice.data, input.number, issuedOn),
        {},
      )).bytes
    } catch {
      await reportError({ fn: FN, code: 'render_failed', ids }, deps.fetch)
      return errorResponse(
        'internal',
        'The invoice could not be generated',
        500,
        req,
      )
    }

    const registered = await service.rpc('register_system_file', {
      p_org_id: access.org_id,
      p_bucket: 'documents',
      p_module_key: 'billing',
      p_purpose: 'billing_professional_invoice',
      p_subject_type: 'payout_period',
      p_subject_id: input.period_id,
      p_mime_type: 'application/pdf',
      p_size_bytes: bytes.length,
      p_sha256: sha256Hex(bytes),
      p_view_permission: 'billing.payroll',
      p_original_name: `Facture ${
        input.number.replace(/[\\/]/g, '-')
      } - ${invoice.data.month_label}.pdf`,
    })
    const row = registeredSchema.safeParse(
      Array.isArray(registered.data) ? registered.data[0] : null,
    )
    if (registered.error || !row.success) {
      await reportError({ fn: FN, code: 'register_failed', ids }, deps.fetch)
      return errorResponse(
        'internal',
        'The invoice could not be generated',
        500,
        req,
      )
    }
    const { file_id, object_path } = row.data

    const upload = await service.storage.from('documents').upload(
      object_path,
      bytes,
      {
        contentType: 'application/pdf',
        upsert: false,
      },
    )
    if (upload.error) {
      await reportError({ fn: FN, code: 'upload_failed', ids }, deps.fetch)
      return errorResponse(
        'internal',
        'The invoice could not be generated',
        500,
        req,
      )
    }

    const recorded = await service.rpc(
      'record_generated_professional_invoice',
      {
        p_period_id: input.period_id,
        p_file_id: file_id,
        p_number: input.number,
        p_issued_on: issuedOn,
        p_actor: user.id,
      },
    )
    if (recorded.error || typeof recorded.data !== 'string') {
      const failure = recorded.error ? rpcFailure(recorded.error, req) : null
      if (failure) return failure
      await reportError({ fn: FN, code: 'record_failed', ids }, deps.fetch)
      return errorResponse(
        'internal',
        'The invoice could not be generated',
        500,
        req,
      )
    }
    return jsonResponse({ invoice_id: recorded.data, file_id }, 200, req)
  }
}
