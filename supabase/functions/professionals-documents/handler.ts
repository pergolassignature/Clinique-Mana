/**
 * `professionals-documents` (Task 4c.3): « Refuser » a professional's
 * document in the record's Documents tab. The only action is `reject`: the
 * « uploaded » notice is created in SQL (P4-403), nothing to send here.
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `professionals` and
 *    `professionals.documents.review`.
 * 2. Body: `{ action: 'reject', document_id, reason }` (the reason capped at
 *    4000 characters here; the RPC trims it and checks 1–1000, in French).
 * 3. `reject_professional_document(p_doc_id, p_reason)` as the caller: a
 *    pending or verified document becomes `rejected` with the reason, its file
 *    soft-deleted (P4-404), never on one's own record. P0001 → 400 with its
 *    French message and its HINT as `field` (`reason`, `document`,
 *    `status`); 42501 → 403; 22023 → 400; anything else → 500, reported.
 * 4. Once refused, the answer is 200 whatever the email does. With the
 *    service client, `get_professional_document_rejection_for_service(p_actor,
 *    p_doc_id)` (the actor `verifyAuth` verified): it answers only for a
 *    document this actor has just refused in their own clinic, with the
 *    professional's first name and address, the clinic's and the type's
 *    names, the stored reason and `uploaded_by_professional`. An RPC error
 *    (`notice_failed`), null (`notice_missing`), a malformed answer or
 *    another clinic (`notice_invalid`) → reported, `email_problem:
 *    'internal'`.
 * 5. The email `professionals.document_rejected` (P4-451) goes only for a file
 *    the professional sent (`uploaded_by_professional`): a file staff
 *    uploaded is theirs to replace, so nothing is sent (`emailed: false,
 *    email_problem: null`). Recipient: the professional's own address, subject
 *    `professional` / id, button « Mes documents » (`APP_URL/mes-documents`,
 *    behind sign-in, no token); an `APP_URL` that is not an accepted origin →
 *    reported `app_url_invalid`, `email_problem: 'server_misconfigured'`.
 *    An explicit send: the 5 s guard per template, address and reviewer
 *    instead of the 60 s same-address limit, so a reviewer refusing two of
 *    a professional's documents within a minute reaches her twice. The
 *    caller's signal is not passed: the refusal is done, its email goes out
 *    even if the tab closes.
 * 6. 200 `{ ok: true, emailed, email_problem }` (+ `retry_after` seconds when
 *    the send was rate-limited). `email_problem` is null when sent or when
 *    nothing was due; else a send's code (`rate_limited`, `not_configured`,
 *    `module_disabled`, `missing_variable`, `recipient_not_allowed`,
 *    `attachment_not_allowed`, `provider_error`, `invalid_recipient`, each
 *    reported `rejection_email_<code>`), `server_misconfigured` (`APP_URL`,
 *    or the send path's own misconfiguration) or `internal` (the notice, the
 *    send path's own failure, or anything unexpected, reported).
 *
 * Status mapping: 200; 400 `invalid_request` (body, P0001, 22023); 401 / 403
 * / 503 from `verifyAuth`; 403 `forbidden` (42501); 405; 413; 500
 * `internal` (another RPC error, reported). Never an address or a name in an
 * answer, a log or a report: codes and row ids only.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { type SendResult, sendTemplatedEmail } from '../_shared/email/send.ts'
import { FunctionError } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import {
  appPageUrl,
  documentRejectedValues,
  isExpectedRpcError,
  MY_DOCUMENTS_PATH,
  professionalsRpcError,
} from '../_shared/professionals.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'professionals-documents'

/** Loose cap on the reason; the RPC checks 1–1000 characters in French. */
const MAX_REASON_LENGTH = 4000

const bodySchema = z.object({
  action: z.literal('reject'),
  document_id: z.guid(),
  reason: z.string().max(MAX_REASON_LENGTH),
})

/** `get_professional_document_rejection_for_service`'s answer. */
const noticeSchema = z.object({
  org_id: z.guid(),
  professional_id: z.guid(),
  document_id: z.guid(),
  profile_id: z.guid().nullable(),
  email: z.string().min(1),
  first_name: z.string().min(1),
  clinic_name: z.string().min(1),
  type_name: z.string().min(1),
  reason: z.string().min(1),
  uploaded_by_professional: z.boolean(),
})

/** Why the email was not sent, when it was due (see the module comment). */
type EmailProblem =
  | Exclude<SendResult, { ok: true }>['code']
  | 'server_misconfigured'
  | 'internal'

/** The documents handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      {
        module: 'professionals',
        permission: 'professionals.documents.review',
      },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const body = await readJson(req, bodySchema)
    if (body instanceof Response) return body
    const client = deps.serviceClient()
    if (client instanceof Response) return client

    const { user_id: actor, org_id: orgId } = auth.access
    const docIds = { document_id: body.document_id }
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError({ fn: FN, code, ids: { org_id: orgId, ...ids } }, deps.fetch)

    const rejected = await auth.client.rpc('reject_professional_document', {
      p_doc_id: body.document_id,
      p_reason: body.reason,
    })
    if (rejected.error) {
      if (!isExpectedRpcError(rejected.error)) {
        await report('reject_failed', docIds)
      }
      return professionalsRpcError(rejected.error, req)
    }

    // Refused: from here on the answer is 200; the email is best effort.
    const answer = (
      emailed: boolean,
      problem: EmailProblem | null,
      retryAfter?: number,
    ) =>
      jsonResponse(
        {
          ok: true,
          emailed,
          email_problem: problem,
          ...(retryAfter !== undefined && { retry_after: retryAfter }),
        },
        200,
        req,
      )

    const { data, error } = await client.rpc(
      'get_professional_document_rejection_for_service',
      { p_actor: actor, p_doc_id: body.document_id },
    )
    if (error) {
      await report('notice_failed', docIds)
      return answer(false, 'internal')
    }
    const parsed = noticeSchema.safeParse(data)
    if (
      !parsed.success || parsed.data.org_id !== orgId ||
      parsed.data.document_id !== body.document_id.toLowerCase()
    ) {
      await report(data === null ? 'notice_missing' : 'notice_invalid', docIds)
      return answer(false, 'internal')
    }
    const notice = parsed.data
    // A file staff uploaded: the template is for one the professional sent.
    if (!notice.uploaded_by_professional) return answer(false, null)

    const ids = { ...docIds, professional_id: notice.professional_id }
    const actionUrl = appPageUrl(deps.env('APP_URL'), MY_DOCUMENTS_PATH)
    if (!actionUrl) {
      await report('app_url_invalid', ids)
      return answer(false, 'server_misconfigured')
    }

    let result: SendResult
    try {
      result = await sendTemplatedEmail(
        { fn: FN, client, env: deps.env, fetch: deps.fetch },
        {
          orgId,
          templateKey: 'professionals.document_rejected',
          to: { email: notice.email, profileId: notice.profile_id },
          subject: { type: 'professional', id: notice.professional_id },
          values: documentRejectedValues({
            firstName: notice.first_name,
            clinicName: notice.clinic_name,
            typeName: notice.type_name,
            reason: notice.reason,
          }),
          actionUrl,
          sentBy: actor,
          explicitResend: true,
        },
      )
    } catch (error) {
      // The send path reports its own failures before throwing them.
      if (error instanceof FunctionError) {
        return answer(
          false,
          error.code === 'server_misconfigured'
            ? 'server_misconfigured'
            : 'internal',
        )
      }
      await report('rejection_email_unexpected', ids)
      return answer(false, 'internal')
    }
    if (result.ok) return answer(true, null)
    await report(`rejection_email_${result.code}`, ids)
    return answer(
      false,
      result.code,
      result.code === 'rate_limited' ? result.retryAfter : undefined,
    )
  }
}
