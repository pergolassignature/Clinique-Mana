/**
 * `signing-test-connection` (design §6.4, « Tester la connexion »): one
 * authenticated read at the clinic's Documenso.
 *
 * 1. CORS; `POST` only; `verifyAuth({ permission:
 *    'settings.integrations_manage' })`.
 * 2. One hit on `LIMITS.signingTestConnectionUser` (30 an hour per caller).
 * 3. The org's URL and key (`orgSigning`): either missing → 503
 *    `not_configured`.
 * 4. `ping()` → 200 `{ ok: true }`, or `{ ok: false, status }` with
 *    Documenso's HTTP status (401: the key is refused). Nothing answered, or
 *    not Documenso → 502 `provider_error`.
 *
 * The answer never holds the key or the URL. Status codes: 200; 401 / 403 /
 * 503 from `verifyAuth`; 405; 429; 502; 503 `not_configured`; 500
 * `internal` (the settings could not be read, reported).
 */
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { DocumensoError } from '../_shared/documenso.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { orgSigning } from '../_shared/signing-events.ts'

const FN = 'signing-test-connection'

/** The test-connection handler; see the module comment. */
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
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id

    const limited = limitResponse(
      await consume(service, LIMITS.signingTestConnectionUser, [
        orgId,
        auth.user.id,
      ]),
      req,
    )
    if (limited) return limited

    try {
      const signing = await orgSigning(service, orgId, deps.fetch, req.signal)
      if (!signing) {
        return errorResponse(
          'not_configured',
          'Signing is not configured',
          503,
          req,
        )
      }
      return jsonResponse(await signing.documenso.ping(), 200, req)
    } catch (error) {
      if (error instanceof DocumensoError) {
        return errorResponse(
          'provider_error',
          'Documenso did not answer',
          502,
          req,
        )
      }
      await reportError({
        fn: FN,
        code: 'signing_config_failed',
        ids: { org_id: orgId },
      }, deps.fetch)
      return errorResponse('internal', 'Test failed', 500, req)
    }
  }
}
