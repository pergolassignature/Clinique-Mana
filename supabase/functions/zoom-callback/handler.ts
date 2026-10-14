/**
 * `zoom-callback` (RZ): the end of a professional's Zoom connection. The
 * app's return page (`/mon-agenda/videoconference`, where Zoom sent the
 * browser with `?code=&state=`) posts both here **with the person's own
 * session**: user function, `verifyAuth` with module `appointments` and
 * `appointments.self`. So a callback is accepted only from the signed-in
 * person the state names, in her clinic.
 *
 * 1. Body `{ code, state }`, strict.
 * 2. One hit on `LIMITS.zoomCallbackUser` (20 an hour per caller).
 * 3. The state (`verifyState`: the MAC, 10 minutes, the purpose): malformed
 *    or forged → 410 `link_invalid`; expired → 410 `link_expired`; another
 *    clinic or person → 403 `forbidden`.
 * 4. The nonce spent once (`spendStateNonce`, kept until the state expires):
 *    a replayed state → 410 `link_used`; the check unavailable → 503.
 * 5. The code exchanged at Zoom's token endpoint with the clinic's Zoom app
 *    (none → 503 `not_configured`): a refused code → 400 with a French
 *    refusal; Zoom down → 502.
 * 6. `users/me` names the account (its id, account and address).
 * 7. `store_zoom_connection` (the actor model: the RPC re-checks the caller
 *    and that she is a professional; a Zoom account connected for another
 *    professional → its P0001, passed on): the connection, its tokens
 *    encrypted, her future video appointments queued for a meeting.
 * 8. 200 `{ email }` (the Zoom address, lower case). The tokens never reach
 *    the browser, a log or a report.
 *
 * Status mapping: 200; 400 `invalid_request` (body, or a refusal with
 * `refusal: true`); 401 / 403 / 503 from `verifyAuth`; 403 `forbidden`
 * (a state of someone else); 405; 410 `link_invalid` / `link_expired` /
 * `link_used`; 413; 429; 500 `server_misconfigured` / `internal`
 * (reported); 502 `provider_error`; 503 `not_configured`.
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
import { spendStateNonce, verifyState } from '../_shared/oauth-state.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import {
  exchangeCode,
  oauthApp,
  ZoomApi,
  ZoomError,
} from '../_shared/zoom/client.ts'
import { redirectUri, zoomOrigins } from '../_shared/zoom/env.ts'

const FN = 'zoom-callback'
const STATE_PURPOSE = 'zoom_connect'

const bodySchema = z.strictObject({
  code: z.string().min(1).max(1_024),
  state: z.string().min(1).max(2_048),
})

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
    const input = await readJson(req, bodySchema, 4_096)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.zoomCallbackUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

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
    const verified = await verifyState(
      secret,
      input.state,
      STATE_PURPOSE,
      deps.now(),
    )
    if (!verified.ok) {
      return verified.reason === 'expired'
        ? errorResponse('link_expired', 'State expired', 410, req)
        : errorResponse('link_invalid', 'State invalid', 410, req)
    }
    const { state } = verified
    if (state.orgId !== orgId || state.userId !== auth.user.id) {
      return errorResponse('forbidden', 'Not your connection', 403, req)
    }
    const spent = await spendStateNonce(service, state)
    if (spent === 'unavailable') {
      return errorResponse(
        'not_configured',
        'State check unavailable',
        503,
        req,
      )
    }
    if (spent === 'used') {
      return errorResponse('link_used', 'State already used', 410, req)
    }

    let app
    try {
      app = await oauthApp(service, orgId)
    } catch {
      await report('oauth_app_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (!app) {
      return errorResponse('not_configured', 'Zoom app is not set', 503, req)
    }

    const origins = zoomOrigins(deps.env)
    let token
    try {
      token = await exchangeCode(
        deps.fetch,
        origins,
        app,
        input.code,
        redirect,
        req.signal,
      )
    } catch (error) {
      if (error instanceof ZoomError && error.code === 'bad_request') {
        return refusalResponse(
          'Zoom a refusé le code de connexion. Recommencez la connexion de votre compte Zoom.',
          req,
        )
      }
      await report(
        error instanceof ZoomError ? `token_${error.code}` : 'token_failed',
      )
      return errorResponse('provider_error', 'Zoom unavailable', 502, req)
    }
    let user
    try {
      user = await new ZoomApi({
        fetch: deps.fetch,
        origin: origins.api,
        accessToken: token.access_token,
        signal: req.signal,
      }).me()
    } catch (error) {
      await report(
        error instanceof ZoomError ? `profile_${error.code}` : 'profile_failed',
      )
      return errorResponse('provider_error', 'Zoom unavailable', 502, req)
    }
    const email = user.email?.trim().toLowerCase() || null
    const expiresAt = new Date(
      deps.now().getTime() + (token.expires_in ?? 3_600) * 1000,
    )
    const stored = await service.rpc('store_zoom_connection', {
      p_actor: auth.user.id,
      p_org_id: orgId,
      p_external_user_id: user.id,
      p_external_account_id: user.account_id ?? '',
      p_account_email: email,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token,
      p_access_token_expires_at: expiresAt.toISOString(),
      p_scopes: (token.scope ?? '').split(/[\s,]+/).filter(Boolean),
    })
    if (stored.error) {
      if (['P0001', '42501'].includes(stored.error.code ?? '')) {
        return rpcErrorResponse(stored.error, req)
      }
      await report('store_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (typeof stored.data !== 'string') {
      await report('store_unusable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    ids.connection_id = stored.data
    return jsonResponse({ email }, 200, req)
  }
}
