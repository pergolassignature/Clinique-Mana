/**
 * `zoom-connect` (RZ): the start of a professional's Zoom connection, and
 * its end. User function: `verifyAuth` with module `appointments` and
 * `appointments.self` (her own account only; the RPCs re-check that she is a
 * professional of the clinic).
 *
 * `{ action: 'start' }` → `{ url }`, Zoom's consent page for the clinic's
 * Zoom app (the two org secrets set in Paramètres → Vidéoconférence; none →
 * 503 `not_configured`), the fixed redirect URI (`APP_URL` +
 * `/mon-agenda/videoconference`; a missing or non-https `APP_URL` → 500) and
 * a **signed state** (`_shared/oauth-state.ts`: the clinic, the person, a
 * nonce, 10 minutes). The browser then goes to Zoom; `zoom-callback`
 * finishes the flow.
 *
 * `{ action: 'disconnect' }` → `{ ok: true, revoked }`: the grant is revoked
 * at Zoom (best effort: it may already be gone), then
 * `disconnect_my_zoom_connection` (the actor model) ends the connection,
 * deletes its tokens and forgets the meetings of her future appointments
 * (they fall back to her fixed link). Nothing connected → 404.
 *
 * One hit on `LIMITS.zoomConnectUser` (20 an hour per caller) for either.
 *
 * Status mapping: 200; 400 `invalid_request` (body, or a refusal with
 * `refusal: true`); 401 / 403 / 503 from `verifyAuth`; 403
 * `module_disabled`; 404 `not_found`; 405; 413; 429 `rate_limited`; 500
 * `server_misconfigured` (no usable `APP_URL`, no `INTERNAL_FUNCTION_SECRET`)
 * / `internal` (reported); 503 `not_configured` (the Zoom app is not set).
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
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { oauthApp, revokeToken } from '../_shared/zoom/client.ts'
import { redirectUri, zoomOrigins } from '../_shared/zoom/env.ts'

const FN = 'zoom-connect'
/** The state's purpose (checked by `zoom-callback`). */
export const STATE_PURPOSE = 'zoom_connect'

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start') }),
  z.strictObject({ action: z.literal('disconnect') }),
])

const credentialsSchema = z.array(z.object({
  connection_id: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
})).max(1)

/** The handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {
      module: 'appointments',
      permission: 'appointments.self',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, 1_024)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.zoomConnectUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

    const origins = zoomOrigins(deps.env)
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
          'Zoom app is not set',
          503,
          req,
        )
      }
      const { state } = await signState(secret, {
        purpose: STATE_PURPOSE,
        orgId,
        userId: auth.user.id,
      }, deps.now())
      const url = new URL(`${origins.oauthPublic}/oauth/authorize`)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', app.clientId)
      url.searchParams.set('redirect_uri', redirect)
      url.searchParams.set('state', state)
      return jsonResponse({ url: url.toString() }, 200, req)
    }

    // Disconnect: Zoom first (best effort), then the database.
    const read = await service.rpc('get_my_zoom_credentials_for_service', {
      p_actor: auth.user.id,
      p_org_id: orgId,
    })
    if (read.error) {
      if (read.error.code === '42501' || read.error.code === 'P0001') {
        return rpcErrorResponse(read.error, req)
      }
      await report('credentials_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const credentials = credentialsSchema.safeParse(read.data)
    if (!credentials.success) {
      await report('credentials_unusable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    let revoked = false
    const row = credentials.data[0]
    if (row) {
      ids.connection_id = row.connection_id
      if (app) {
        revoked = await revokeToken(deps.fetch, origins, app, row.access_token)
      }
    }
    const done = await service.rpc('disconnect_my_zoom_connection', {
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
      return errorResponse('not_found', 'Nothing connected', 404, req)
    }
    return jsonResponse({ ok: true, revoked }, 200, req)
  }
}
