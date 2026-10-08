/**
 * `email-test-send` (Task 3.10): « M'envoyer un test » from the « Modèles »
 * editor. Sends the effective template, or the unsaved draft, with sample
 * values and a « [Test] » subject, to the caller.
 *
 * - CORS; `POST` only; `verifyAuth` with `settings.email_manage`.
 * - Body `{ template_key, subject?, body?, button_label? }`: a draft has both
 *   `subject` and `body` (rules: `../_shared/email/draft.ts`), else none of
 *   the three. The « Modèles » editor sends all three fields of its draft;
 *   `button_label` null or empty means « no button », and an omitted one
 *   keeps the effective template's label. Any other field (a `to`, an
 *   `org_id`) is ignored. A `{{` or `}}` outside a placeholder → 400
 *   `invalid_request` « Accolades non fermées dans le texte. » (SQL's
 *   check), before any RPC.
 * - The recipient is always the caller's own address (`auth.access.email`,
 *   `profiles.email`) and the org the caller's; the log row is subject
 *   `email_test` / the caller.
 * - `sendTemplatedEmail` in test mode (`../_shared/email/send.ts`): limits
 *   `emails.test` (10 per hour per caller), `emails.repeat_guard` (5 s) and
 *   `emails.org_day`.
 *
 * Status mapping: ok 200 `{ email_log_id }`; `rate_limited` 429 (with
 * `Retry-After`); `not_configured` 503; `provider_error` 502;
 * `missing_variable` 400 `invalid_request` with `variable`, as
 * `email-preview` (in test mode samples fill every value, so this is an
 * unknown placeholder); `invalid_recipient` 400 `invalid_request`;
 * `module_disabled` 403; `recipient_not_allowed` 403 `forbidden`. A
 * `FunctionError` from the send path (already reported): `not_found` (an
 * unknown template key) 404, any other code 500.
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
import {
  draftBodySchema,
  draftBraceError,
  draftButtonSchema,
  draftSubjectSchema,
  templateKeySchema,
} from '../_shared/email/draft.ts'
import { type SendResult, sendTemplatedEmail } from '../_shared/email/send.ts'
import { FunctionError } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'email-test-send'

const bodySchema = z.object({
  template_key: templateKeySchema,
  subject: draftSubjectSchema.optional(),
  body: draftBodySchema.optional(),
  button_label: draftButtonSchema.optional(),
}).refine((b) =>
  b.subject === undefined
    ? b.body === undefined && b.button_label === undefined
    : b.body !== undefined
)

/** The HTTP answer for a send outcome (see the module comment). */
function outcomeResponse(result: SendResult, req: Request): Response {
  if (result.ok) {
    return jsonResponse({ email_log_id: result.emailLogId }, 200, req)
  }
  switch (result.code) {
    case 'rate_limited': {
      const res = errorResponse(
        'rate_limited',
        'Too many test emails',
        429,
        req,
      )
      res.headers.set('Retry-After', String(result.retryAfter))
      return res
    }
    case 'not_configured':
      return errorResponse(
        'not_configured',
        'Email is not configured',
        503,
        req,
      )
    case 'provider_error':
      return errorResponse('provider_error', 'Email provider failed', 502, req)
    case 'missing_variable':
      return jsonResponse(
        {
          error: {
            code: 'invalid_request',
            message: 'Unknown variable',
            variable: result.path.slice(0, 80),
          },
        },
        400,
        req,
      )
    case 'invalid_recipient':
      return errorResponse('invalid_request', 'Invalid recipient', 400, req)
    case 'module_disabled':
      return errorResponse('module_disabled', 'Module disabled', 403, req)
    case 'recipient_not_allowed':
    case 'attachment_not_allowed':
      return errorResponse('forbidden', 'Not allowed', 403, req)
  }
}

/** The test-send handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { permission: 'settings.email_manage' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const braces = draftBraceError(
      input.subject,
      input.body,
      input.button_label,
    )
    if (braces) return refusalResponse(braces, req)
    const client = deps.serviceClient()
    if (client instanceof Response) return client

    const { user_id: callerId, org_id: orgId, email } = auth.access
    try {
      const result = await sendTemplatedEmail(
        {
          fn: FN,
          client,
          env: deps.env,
          fetch: deps.fetch,
          signal: req.signal,
        },
        {
          orgId,
          templateKey: input.template_key,
          to: { email, profileId: callerId },
          subject: { type: 'email_test', id: callerId },
          values: {},
          actionUrl: null,
          sentBy: callerId,
          test: {
            callerId,
            draft: input.subject !== undefined && input.body !== undefined
              ? {
                subject: input.subject,
                body: input.body,
                // undefined (omitted) keeps the effective label.
                buttonLabel: input.button_label,
              }
              : undefined,
          },
        },
      )
      return outcomeResponse(result, req)
    } catch (error) {
      // The send path reports its own failures before throwing them.
      if (error instanceof FunctionError) {
        return error.code === 'not_found'
          ? errorResponse('not_found', 'Unknown template', 404, req)
          : errorResponse(error.code, 'Test email failed', 500, req)
      }
      await reportError(
        { fn: FN, code: 'unexpected', ids: { org_id: orgId } },
        deps.fetch,
      )
      return errorResponse('internal', 'Test email failed', 500, req)
    }
  }
}
