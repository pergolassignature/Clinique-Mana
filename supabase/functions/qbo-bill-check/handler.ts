/**
 * `qbo-bill-check` (Facturation, BI-27): « Bill annulé dans QuickBooks » on a
 * payroll period. Since BI-23 a period whose invoice QuickBooks has is never
 * reopened nor its invoice replaced; once the administration deleted the
 * Bill in QuickBooks, this asks QuickBooks and, only when the Bill is gone,
 * forgets it so the period can be reopened.
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `billing` and
 *    `billing.payroll` (who may reopen a period; not `qbo-sync`'s
 *    `billing.settings`, hence its own function).
 * 2. One hit on `LIMITS.qboBillCheckUser` (30 an hour per caller); body
 *    `{ period_id }`, strict.
 * 3. `qbo_bill_to_check_for_service` (service, `p_actor` the caller, the org
 *    from `verifyAuth`): the permission first, a validated period of the
 *    caller's clinic with a Bill → its id (P0001 refusals → 400).
 * 4. The clinic's Intuit application, then `GET bill/<id>` with the
 *    company's token (`withFreshToken`: one refresh on a 401).
 * 5. QuickBooks still has it → 400 refusal « Le Bill existe toujours dans
 *    QuickBooks : supprimez-le d'abord. ». Gone (fault 610) or voided (a zero
 *    total) → `clear_qbo_bill_for_service` (the same checks under the
 *    period's lock, the Bill unchanged) → 200 `{ status: 'cleared', qbo }`
 *    (`qbo`: `deleted` or `voided`).
 *
 * Status codes: 200; 400 (body, or a French refusal); 401 / 403 from
 * `verifyAuth` or 42501; 404 `not_found` (no QuickBooks connection); 405;
 * 409 `conflict` (Intuit refused the token: « Reconnecter »); 413; 429;
 * 502 `provider_error` (QuickBooks did not answer usably); 503
 * `not_configured` (the Intuit application's secrets); 500 `internal`.
 * Reports carry the org and period ids and a code only, never Intuit's text.
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
import { rpcErrorResponse } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { QboError } from '../_shared/qbo/client.ts'
import {
  NotConnected,
  oauthApp,
  ReconnectNeeded,
} from '../_shared/qbo/credentials.ts'
import { qboOrigins } from '../_shared/qbo/env.ts'
import { withFreshToken } from '../_shared/qbo/sync.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'qbo-bill-check'
const BUDGET_MS = 30_000
export const STILL_THERE =
  "Le Bill existe toujours dans QuickBooks : supprimez-le d'abord."

const bodySchema = z.strictObject({ period_id: z.guid() })
const toCheckSchema = z.object({ bill_id: z.string().regex(/^[0-9]{1,32}$/) })

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
      permission: 'billing.payroll',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const actor = auth.user.id

    const limited = limitResponse(
      await consume(service, LIMITS.qboBillCheckUser, [orgId, actor]),
      req,
    )
    if (limited) return limited
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const ids = { org_id: orgId, payout_period_id: input.period_id }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)
    const args = {
      p_actor: actor,
      p_org_id: orgId,
      p_period_id: input.period_id,
    }

    const toCheck = await service.rpc('qbo_bill_to_check_for_service', args)
    if (toCheck.error) {
      if (!['P0001', '42501'].includes(toCheck.error.code ?? '')) {
        await report('prepare_failed')
      }
      return rpcErrorResponse(toCheck.error, req)
    }
    const bill = toCheckSchema.safeParse(toCheck.data)
    if (!bill.success) {
      await report('prepare_invalid')
      return errorResponse('internal', 'Request failed', 500, req)
    }

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

    let state
    try {
      state = await withFreshToken(
        {
          client: service,
          fetch: deps.fetch,
          origins: qboOrigins(deps.env),
          now: deps.now,
          orgId,
          signal: req.signal,
          softDeadline: Date.now() + BUDGET_MS,
        },
        app,
        (qbo) => qbo.billState(bill.data.bill_id),
      )
    } catch (error) {
      if (error instanceof NotConnected) {
        return errorResponse('not_found', 'Not connected', 404, req)
      }
      if (error instanceof ReconnectNeeded) {
        return errorResponse(
          'conflict',
          'QuickBooks needs reconnection',
          409,
          req,
        )
      }
      await report(
        error instanceof QboError ? `qbo_${error.code}` : 'bill_read_failed',
      )
      return errorResponse(
        'provider_error',
        'QuickBooks did not answer',
        502,
        req,
      )
    }
    if (state === 'present') return refusalResponse(STILL_THERE, req)

    const cleared = await service.rpc('clear_qbo_bill_for_service', {
      ...args,
      p_bill_id: bill.data.bill_id,
    })
    if (cleared.error) {
      if (!['P0001', '42501'].includes(cleared.error.code ?? '')) {
        await report('clear_failed')
      }
      return rpcErrorResponse(cleared.error, req)
    }
    return jsonResponse({ status: 'cleared', qbo: state }, 200, req)
  }
}
