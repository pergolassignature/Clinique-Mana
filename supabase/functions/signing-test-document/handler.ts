/**
 * `signing-test-document` (design §6.3–§6.4, « Envoyer un document test »):
 * sends the built-in one-page test document to the caller, which proves the
 * URL, the key, the webhook and the signed-PDF storage end to end without a
 * module. This function renders (`_shared/signing.ts`), so it carries
 * pdfmake.
 *
 * 1. CORS; `POST` only; `verifyAuth({ permission:
 *    'settings.integrations_manage' })`.
 * 2. Body `{ idempotency_key }` (a uuid the page draws per click), strict.
 *    The request's key is `core.signing_test:<caller>:<key>`: a double click
 *    returns the same request, and a key never reaches another caller's.
 * 3. One hit on `LIMITS.signingTestDocumentUser` (10 an hour per caller).
 * 4. `createSignatureRequest` with purpose `core.signing_test`, no template
 *    version, the document `signingTestDocument(org name)`, subject
 *    `signing_test` / the caller, view permission
 *    `settings.integrations_manage`, and one signer: the caller (role
 *    `clinic`, `display_name`, `email`).
 * 5. 200 `{ request_id, existing }`. The page already knows the caller's
 *    address for its toast: the answer never holds one.
 *
 * The send does not follow the caller's connection (`req.signal` is not
 * passed): a closed tab never cuts a send between Documenso and the
 * database, and its cleanup cancel always runs (`_shared/signing.ts`).
 *
 * Status codes: 200; 400 `invalid_request` (body, or the database's French
 * refusal); 401 / 403 / 503 from `verifyAuth`; 405; 409 `conflict`
 * (« Un envoi est déjà en cours. »: the same key while its send runs); 413;
 * 429; 502
 * `provider_error` (Documenso failed; the draft can be sent again with the
 * same key); 503 `not_configured` (no URL or key, the key refused, no logo
 * for a template that needs one, or the limiter down); 500 `internal`
 * (reported with the org and request ids).
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
import {
  SIGNING_TEST_EMAIL,
  signingTestDocument,
} from '../_shared/pdf/test-document.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import {
  documensoReach,
  type SigningFailure,
} from '../_shared/signing-events.ts'
import { createSignatureRequest } from '../_shared/signing.ts'

const FN = 'signing-test-document'

const bodySchema = z.strictObject({ idempotency_key: z.guid() })

const STATUS = {
  not_configured: 503,
  module_disabled: 403,
  missing_variable: 400,
  provider_error: 502,
  invalid_request: 400,
  send_in_progress: 409,
} as const

/** The test-document handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { permission: 'settings.integrations_manage' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const { access, user } = auth

    const limited = limitResponse(
      await consume(service, LIMITS.signingTestDocumentUser, [
        access.org_id,
        user.id,
      ]),
      req,
    )
    if (limited) return limited

    try {
      const result = await createSignatureRequest({
        client: service,
        fetch: deps.fetch,
        reach: documensoReach(deps),
        now: deps.now,
      }, {
        orgId: access.org_id,
        moduleKey: 'core',
        purpose: 'core.signing_test',
        templateVersionId: null,
        subject: { type: 'signing_test', id: user.id },
        title: 'Document test de signature électronique',
        viewPermission: 'settings.integrations_manage',
        values: {},
        signers: [{
          role: 'clinic',
          name: access.display_name,
          email: access.email,
          order: 1,
        }],
        idempotencyKey: `core.signing_test:${user.id}:${input.idempotency_key}`,
        sentBy: user.id,
        document: signingTestDocument(access.org_name),
        email: SIGNING_TEST_EMAIL,
      })
      if (result.ok) {
        return jsonResponse(
          { request_id: result.requestId, existing: result.existing },
          200,
          req,
        )
      }
      // The database's French refusal (P0001), shown as is.
      if (result.code === 'invalid_request') {
        return refusalResponse(result.message, req)
      }
      const message = result.code === 'send_in_progress'
        ? result.message
        : 'The test document could not be sent'
      return errorResponse(
        result.code === 'send_in_progress' ? 'conflict' : result.code,
        message,
        STATUS[result.code],
        req,
      )
    } catch (error) {
      const { code, requestId } = error as Partial<SigningFailure>
      await reportError({
        fn: FN,
        code: typeof code === 'string' ? code : 'signing_test_failed',
        ids: requestId
          ? { org_id: access.org_id, signature_request_id: requestId }
          : { org_id: access.org_id },
      }, deps.fetch)
      return errorResponse(
        'internal',
        'The test document could not be sent',
        500,
        req,
      )
    }
  }
}
