/**
 * `qbo-sync` (plan §8, FQ): « Synchroniser » in Paramètres → QuickBooks (and
 * right after a connection). User function: `verifyAuth` with module
 * `billing` and `billing.settings`; one hit on `LIMITS.qboSyncUser` (30 an
 * hour per caller).
 *
 * One read pass (`_shared/qbo/sync.ts`): the company's name, the chart of
 * accounts (then Christine's defaults on the map), the customers, the
 * matching with Clients' rules (until done or 100 s: the report says « la
 * correspondance continue » and the next click resumes). Nothing is written
 * to QuickBooks (FQ-4).
 *
 * 200 `{ status, accounts, customers, matched, pending }` (`status` `ok`,
 * `partial` or `failed`: a failed read is recorded on the connection, with
 * its code, and answered 200 so the screen shows it); 404 `not_found` (no
 * connection); 409 `conflict` (Intuit refused the refresh: « Reconnecter »);
 * 503 `not_configured`. Counts only: never a name, an email or a phone.
 */
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  NotConnected,
  oauthApp,
  ReconnectNeeded,
} from '../_shared/qbo/credentials.ts'
import { qboOrigins } from '../_shared/qbo/env.ts'
import { runQboSync } from '../_shared/qbo/sync.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'qbo-sync'
const BUDGET_MS = 100_000

/** The handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {
      module: 'billing',
      permission: 'billing.settings',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const report = (code: string) =>
      reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.qboSyncUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

    let app
    try {
      app = await oauthApp(service, orgId)
    } catch {
      await report('oauth_app_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (!app) {
      return errorResponse(
        'not_configured',
        'Intuit application is not set',
        503,
        req,
      )
    }

    try {
      const result = await runQboSync({
        client: service,
        fetch: deps.fetch,
        origins: qboOrigins(deps.env),
        now: deps.now,
        orgId,
        signal: req.signal,
        softDeadline: Date.now() + BUDGET_MS,
      }, app)
      if (result.status === 'failed') {
        await report(result.errorCode ?? 'sync_failed')
      }
      return jsonResponse(
        {
          status: result.status,
          accounts: result.accounts,
          customers: result.customers,
          matched: result.matched,
          pending: result.pending,
        },
        200,
        req,
      )
    } catch (error) {
      if (error instanceof ReconnectNeeded) {
        return errorResponse(
          'conflict',
          'QuickBooks needs reconnection',
          409,
          req,
        )
      }
      if (error instanceof NotConnected) {
        return errorResponse('not_found', 'Not connected', 404, req)
      }
      await report('sync_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
  }
}
