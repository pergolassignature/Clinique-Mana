/**
 * `qbo-connect` (plan §8, FQ): « Connecter QuickBooks » and « Déconnecter »
 * in Paramètres → QuickBooks. User function: `verifyAuth` with module
 * `billing` and `billing.settings` (PS Hub let any signed-in user start the
 * flow, roadmap §2.6).
 *
 * - `{ action: 'start', environment }` → `{ url }`: Intuit's consent page
 *   with the clinic's application (none → 503 `not_configured`), the one
 *   accounting scope, the fixed return address `APP_URL/facturation/
 *   retour-quickbooks`, and a signed, single-use state (clinic, person,
 *   environment, 10 minutes; PS Hub's was unsigned base64).
 * - `{ action: 'disconnect' }` → `{ ok, revoked }`: the refresh token revoked
 *   at Intuit (best effort), then `disconnect_qbo_connection` (the tokens
 *   deleted; the snapshots, matches and links kept). Nothing to disconnect →
 *   404.
 *
 * One hit on `LIMITS.qboConnectUser` (20 an hour per caller). The tokens
 * never reach the browser, a log or a report.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { rpcErrorResponse } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { signState } from '../_shared/oauth-state.ts'
import { oauthApp, revokeToken } from '../_shared/qbo/credentials.ts'
import {
  QBO_ENVIRONMENTS,
  QBO_SCOPE,
  qboOrigins,
  redirectUri,
} from '../_shared/qbo/env.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'qbo-connect'
/** The state's purpose (checked by `qbo-callback`). */
export const STATE_PURPOSE = 'qbo_connect'

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('start'),
    environment: z.enum(QBO_ENVIRONMENTS).default('production'),
  }),
  z.strictObject({ action: z.literal('disconnect') }),
])

const credentialsSchema = z.array(z.object({ refresh_token: z.string() })).max(
  1,
)

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
    const input = await readJson(req, bodySchema, 2_048)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const report = (code: string) =>
      reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.qboConnectUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited
    const origins = qboOrigins(deps.env)

    let app
    try {
      app = await oauthApp(service, orgId)
    } catch {
      await report('oauth_app_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }

    if (input.action === 'start') {
      const secret = deps.env('INTERNAL_FUNCTION_SECRET')
      const redirect = redirectUri(deps.env)
      if (!secret || !redirect) {
        await report(secret ? 'app_url_unusable' : 'secret_missing')
        return errorResponse(
          'server_misconfigured',
          'Server misconfigured',
          500,
          req,
        )
      }
      if (!app) {
        return errorResponse(
          'not_configured',
          'Intuit application is not set',
          503,
          req,
        )
      }
      const { state } = await signState(secret, {
        purpose: STATE_PURPOSE,
        orgId,
        userId: auth.user.id,
        data: { environment: input.environment },
      }, deps.now())
      const url = new URL(`${origins.appcenterPublic}/connect/oauth2`)
      url.searchParams.set('client_id', app.clientId)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', QBO_SCOPE)
      url.searchParams.set('redirect_uri', redirect)
      url.searchParams.set('state', state)
      return jsonResponse({ url: url.toString() }, 200, req)
    }

    // Disconnect: Intuit first (best effort), then the database.
    const read = await service.rpc('get_qbo_credentials', { p_org_id: orgId })
    const credentials = credentialsSchema.safeParse(read.data)
    if (read.error || !credentials.success) {
      await report('credentials_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const row = credentials.data[0]
    const revoked = row && app
      ? await revokeToken(deps.fetch, origins, app, row.refresh_token)
      : false
    const done = await service.rpc('disconnect_qbo_connection', {
      p_actor: auth.user.id,
      p_org_id: orgId,
    })
    if (done.error) {
      if (done.error.code === '42501' || done.error.code === 'P0001') {
        return rpcErrorResponse(done.error, req)
      }
      await report('disconnect_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (done.data !== true) {
      return errorResponse('not_found', 'Not connected', 404, req)
    }
    return jsonResponse({ ok: true, revoked }, 200, req)
  }
}
