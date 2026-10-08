/**
 * `professionals-submit` (Task 4b.2): « Envoyer mon profil » at the end of
 * the provider's questionnaire.
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `professionals` and
 *    `professionals.self`.
 * 2. Body: a JSON object; every field is ignored (the submission is the
 *    caller's own open one, found by the RPC).
 * 3. `submit_my_submission` as the caller: every requested section complete,
 *    the staff checks, `submitted`, the file `in_review` for an onboarding,
 *    and the in-app notice to `professionals.review` (created in SQL, P4-271,
 *    so it exists whatever happens to the emails). P0001 → 400 with its French
 *    message, its HINT as `field` and, for incomplete sections, their keys as
 *    `sections`; 42501 → 403; 22023 → 400; anything else → 500, reported.
 *    Not rate-limited: a refusal sends nothing, and the caller could call
 *    the RPC directly anyway.
 * 4. Once submitted, `professionals.submit_user` (10 per hour per caller,
 *    P4-261): it caps the reviewers' emails, so only successful submissions
 *    count (a provider fixing incomplete steps is never locked out). A
 *    refused or failed limiter skips the emails, reported
 *    (`reviewer_emails_rate_limited` / `reviewer_emails_limit_unavailable`);
 *    the in-app notice remains.
 * 5. The reviewers' email (`professionals.submission_received`):
 *    `get_professional_submission_notice_for_service(p_actor)` with the
 *    service client (the actor `verifyAuth` verified; her clinic's active
 *    members holding `professionals.review`, at most 20, the provider
 *    excluded; more than 20 is refused as `notice_invalid`, nothing sent),
 *    then one send per reviewer, in parallel, subject `professional` / id,
 *    button to the file's documents tab. Each is an explicit send (P4-264):
 *    the 5 s guard per reviewer and provider instead of the 60 s
 *    same-address limit, so two providers submitting within a minute both
 *    reach the reviewers. The caller's signal is not passed: the submission
 *    is done, its emails go out even if the tab closes.
 * 6. 200 `{ ok: true }`, whatever the emails did: a failure is reported (codes
 *    and ids only) and the in-app notice remains. The provider never learns
 *    who reviews nor whether an email failed.
 *
 * Status mapping: 200; 400 `invalid_request` (body, P0001, 22023); 401 / 403
 * / 503 from `verifyAuth`; 403 `forbidden` (42501); 405; 413; 500
 * `internal` (another RPC error, reported). Never 429: the limit applies
 * after the submission, to the emails only. Reviewers' addresses
 * never reach an answer, a log or a report.
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
  isExpectedRpcError,
  professionalDocumentsPath,
  professionalsRpcError,
  submissionReceivedValues,
} from '../_shared/professionals.ts'
import { consume, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'professionals-submit'

/** At most this many reviewers are emailed (the RPC caps it too). */
const MAX_REVIEWERS = 20

/** `get_professional_submission_notice_for_service`'s answer. */
const noticeSchema = z.object({
  org_id: z.guid(),
  professional_id: z.guid(),
  submission_id: z.guid(),
  full_name: z.string().min(1),
  reviewers: z.array(z.object({ user_id: z.guid(), email: z.string() }))
    .max(MAX_REVIEWERS),
})

/** The submit handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { module: 'professionals', permission: 'professionals.self' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const body = await readJson(req, z.object({}))
    if (body instanceof Response) return body
    const client = deps.serviceClient()
    if (client instanceof Response) return client

    const { user_id: actor, org_id: orgId } = auth.access
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError({ fn: FN, code, ids: { org_id: orgId, ...ids } }, deps.fetch)

    const submitted = await auth.client.rpc('submit_my_submission')
    if (submitted.error) {
      if (!isExpectedRpcError(submitted.error)) await report('submit_failed')
      return professionalsRpcError(submitted.error, req)
    }
    const ok = () => jsonResponse({ ok: true }, 200, req)

    // Submitted: from here on the answer is 200; the emails are best effort.
    // Only a submission that went through counts against the limit (step 4).
    const limit = await consume(client, LIMITS.professionalSubmitUser, [
      orgId,
      actor,
    ])
    if (!limit.allowed) {
      await report(
        limit.reason === 'unavailable'
          ? 'reviewer_emails_limit_unavailable'
          : 'reviewer_emails_rate_limited',
      )
      return ok()
    }
    const { data, error } = await client.rpc(
      'get_professional_submission_notice_for_service',
      { p_actor: actor },
    )
    if (error) {
      await report('notice_failed')
      return ok()
    }
    const parsed = noticeSchema.safeParse(data)
    if (!parsed.success || parsed.data.org_id !== orgId) {
      await report(data === null ? 'notice_missing' : 'notice_invalid')
      return ok()
    }
    const notice = parsed.data
    const ids = {
      professional_id: notice.professional_id,
      submission_id: notice.submission_id,
    }
    if (notice.reviewers.length === 0) {
      await report('no_reviewer', ids)
      return ok()
    }
    const actionUrl = appPageUrl(
      deps.env('APP_URL'),
      professionalDocumentsPath(notice.professional_id),
    )
    if (!actionUrl) {
      await report('app_url_invalid', ids)
      return ok()
    }

    const results = await Promise.all(
      notice.reviewers.map(async (reviewer): Promise<string> => {
        let result: SendResult
        try {
          result = await sendTemplatedEmail(
            { fn: FN, client, env: deps.env, fetch: deps.fetch },
            {
              orgId,
              templateKey: 'professionals.submission_received',
              to: { email: reviewer.email, profileId: reviewer.user_id },
              subject: { type: 'professional', id: notice.professional_id },
              values: submissionReceivedValues({ fullName: notice.full_name }),
              actionUrl,
              sentBy: actor,
              explicitResend: true,
            },
          )
        } catch (error) {
          // The send path reports its own failures before throwing them.
          return error instanceof FunctionError ? 'reported' : 'unexpected'
        }
        return result.ok ? 'sent' : result.code
      }),
    )
    // One report per failure kind (the provider's answer does not change).
    const failures = new Set(
      results.filter((r) => r !== 'sent' && r !== 'reported'),
    )
    for (const code of failures) await report(`reviewer_email_${code}`, ids)
    return ok()
  }
}
