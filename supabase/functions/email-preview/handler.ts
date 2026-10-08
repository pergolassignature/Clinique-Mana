/**
 * `email-preview` (Task 3.10): renders an unsaved template for the « Modèles »
 * editor, with the catalogue's sample values. Nothing is stored or sent.
 *
 * - CORS; `POST` only; `verifyAuth` with `settings.view`: a preview stores
 *   and sends nothing, so anyone who can read the settings may render one
 *   (`email-test-send` keeps `settings.email_manage`).
 * - Body `{ template_key, subject, body, button_label }` (`../_shared/email/draft.ts`).
 *   A `{{` or `}}` outside a placeholder → 400 `invalid_request`
 *   « Accolades non fermées dans le texte. » (SQL's check), before any RPC.
 * - `get_email_context` for the caller's org (never one from the body): an
 *   unknown key → 404 `not_found`; a disabled module → 403 `module_disabled`.
 * - `composeEmail` in `preview` mode over the draft text. Values are escaped
 *   and the body goes through the markup renderer, so no markup from the
 *   input (a `<script>`) reaches the HTML. An unknown placeholder → 400
 *   `invalid_request` with `variable` (the UI shows « Variable inconnue »).
 * - `{ subject, html, text }`; HTML over 200 KB → 413 `invalid_request`.
 *
 * Reports carry the function name, a code and the org id only.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { composeEmail } from '../_shared/email/compose.ts'
import {
  draftBodySchema,
  draftBraceError,
  draftButtonSchema,
  draftSubjectSchema,
  templateKeySchema,
} from '../_shared/email/draft.ts'
import { safeUrl } from '../_shared/email/render.ts'
import { parseEmailContext } from '../_shared/email/send.ts'
import { readJson } from '../_shared/http.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'email-preview'
/** Previews are bounded (plan « Review checklist »). */
const MAX_HTML_BYTES = 200 * 1024

const bodySchema = z.object({
  template_key: templateKeySchema,
  subject: draftSubjectSchema,
  body: draftBodySchema,
  button_label: draftButtonSchema,
})

/** The preview handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { permission: 'settings.view' },
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
    if (braces) return errorResponse('invalid_request', braces, 400, req)

    const orgId = auth.access.org_id
    const report = (code: string) =>
      reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)
    const appUrl = deps.env('APP_URL')?.trim() ?? ''
    if (!safeUrl(appUrl, true)) {
      await report('app_url_missing')
      return errorResponse('not_configured', 'Not configured', 503, req)
    }
    const client = deps.serviceClient()
    if (client instanceof Response) return client

    const { data, error } = await client.rpc('get_email_context', {
      p_org_id: orgId,
      p_template_key: input.template_key,
    })
    if (error?.code === '22023') {
      return errorResponse('not_found', 'Unknown template', 404, req)
    }
    const parsed = error ? null : parseEmailContext(data)
    if (!parsed) {
      await report(error ? 'email_context_failed' : 'email_context_invalid')
      return errorResponse('internal', 'Preview failed', 500, req)
    }
    if (!parsed.moduleEnabled) {
      return errorResponse('module_disabled', 'Module disabled', 403, req)
    }

    const { context } = parsed
    context.template = {
      ...context.template,
      subject: input.subject,
      body: input.body,
      buttonLabel: input.button_label,
    }
    const composed = composeEmail(context, {
      values: {},
      actionUrl: null,
      appUrl,
      mode: 'preview',
    })
    if (!composed.ok) {
      if (composed.code === 'invalid_timezone') {
        await report('email_timezone_invalid')
        return errorResponse('server_misconfigured', 'Preview failed', 500, req)
      }
      return jsonResponse(
        {
          error: {
            code: 'invalid_request',
            message: composed.code === 'unknown_variable'
              ? 'Unknown variable'
              : 'Missing variable',
            variable: composed.path.slice(0, 80),
          },
        },
        400,
        req,
      )
    }
    if (new TextEncoder().encode(composed.html).length > MAX_HTML_BYTES) {
      return errorResponse('invalid_request', 'Preview too large', 413, req)
    }
    return jsonResponse(
      {
        subject: composed.subject,
        html: composed.html,
        text: composed.text,
      },
      200,
      req,
    )
  }
}
