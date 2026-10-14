/**
 * `google-calendar-callback` (R6): the end of a professional's Google
 * busy-time connection. The app's return page (`/mon-agenda/agenda-google`,
 * where Google sent the browser with `?code=&state=`) posts both here **with
 * the person's own session**: user function, `verifyAuth` with module
 * `appointments` and `appointments.self`.
 *
 * 1. Body `{ code, state }`, strict.
 * 2. One hit on `LIMITS.googleCalendarCallbackUser` (20 an hour per caller).
 * 3. The state (`verifyState`: the MAC, 10 minutes, the purpose): malformed or
 *    forged → 410 `link_invalid`; expired → 410 `link_expired`; another clinic
 *    or person → 403 `forbidden`; the nonce spent once (a replay → 410
 *    `link_used`).
 * 4. The code exchanged with the clinic's Google application (none → 503): a
 *    refused code → 400 with a French refusal; Google down → 502.
 * 5. The grant must hold `calendar.freebusy` (she may untick it): else a
 *    French refusal, and the grant is revoked.
 * 6. Without a refresh token Google is asked again (a French refusal) and the
 *    grant is revoked; then `userinfo` names the account (`sub`, the address).
 * 7. `store_calendar_connection` (the actor model: P0001 when this account is
 *    connected for another professional), then a first sync at once (best
 *    effort: the job catches up).
 * 8. 200 `{ email, busy }` (the address; how many busy times were read, or
 *    null). The tokens never reach the browser, a log or a report.
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
import { GmailError } from '../_shared/gmail/client.ts'
import { exchangeCode, revokeToken } from '../_shared/gmail/credentials.ts'
import { calendarOAuthApp } from '../_shared/google-calendar/credentials.ts'
import {
  CalendarError,
  CalendarReconnect,
  hasFreeBusyScope,
  syncConnection,
  userInfo,
} from '../_shared/google-calendar/client.ts'
import { calendarOrigins, redirectUri } from '../_shared/google-calendar/env.ts'
import { readJson } from '../_shared/http.ts'
import { verifyState } from '../_shared/oauth-state.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'google-calendar-callback'
const STATE_PURPOSE = 'google_calendar_connect'

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
      await consume(service, LIMITS.googleCalendarCallbackUser, [
        orgId,
        auth.user.id,
      ]),
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
    const nonce = await consume(service, LIMITS.oauthStateNonce, [state.nonce])
    if (!nonce.allowed) {
      return nonce.reason === 'unavailable'
        ? limitResponse(nonce, req)!
        : errorResponse('link_used', 'State already used', 410, req)
    }

    let app
    try {
      app = await calendarOAuthApp(service, orgId)
    } catch {
      await report('oauth_app_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (!app) {
      return errorResponse('not_configured', 'Google app is not set', 503, req)
    }

    const origins = calendarOrigins(deps.env)
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
      if (error instanceof GmailError && error.code === 'bad_request') {
        return refusalResponse(
          'Google a refusé le code de connexion. Recommencez la connexion de votre agenda Google.',
          req,
        )
      }
      await report(
        error instanceof GmailError ? `token_${error.code}` : 'token_failed',
      )
      return errorResponse('provider_error', 'Google unavailable', 502, req)
    }
    const scopes = (token.scope ?? '').split(/[\s,]+/).filter(Boolean)
    if (!hasFreeBusyScope(scopes)) {
      await revokeToken(
        deps.fetch,
        origins,
        token.refresh_token ?? token.access_token,
      )
      return refusalResponse(
        'La permission de voir vos disponibilités n’a pas été accordée. Recommencez et laissez cochée « Voir vos disponibilités ».',
        req,
      )
    }
    if (!token.refresh_token) {
      // The grant is not kept: revoked as when the scope is missing (nothing stored).
      await revokeToken(deps.fetch, origins, token.access_token)
      return refusalResponse(
        'Google n’a pas donné d’accès durable. Recommencez la connexion de votre agenda Google.',
        req,
      )
    }
    let user
    try {
      user = await userInfo(deps.fetch, origins, token.access_token, req.signal)
    } catch (error) {
      await report(
        error instanceof CalendarError
          ? `profile_${error.code}`
          : error instanceof CalendarReconnect
          ? 'profile_unauthorized'
          : 'profile_failed',
      )
      return errorResponse('provider_error', 'Google unavailable', 502, req)
    }
    const expiresAt = new Date(
      deps.now().getTime() + (token.expires_in ?? 3_600) * 1000,
    )
    const stored = await service.rpc('store_calendar_connection', {
      p_actor: auth.user.id,
      p_org_id: orgId,
      p_external_user_id: user.sub,
      p_account_email: user.email,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token,
      p_access_token_expires_at: expiresAt.toISOString(),
      p_scopes: scopes,
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

    // A first sync at once (best effort: the job catches up).
    let busy: number | null = null
    try {
      const outcome = await syncConnection(
        {
          client: service,
          fetch: deps.fetch,
          origins,
          app,
          now: deps.now,
          signal: req.signal,
        },
        orgId,
        stored.data,
      )
      if (outcome.startsWith('synced:')) {
        busy = Number(outcome.slice('synced:'.length))
      }
    } catch {
      await report('first_sync_failed')
    }
    return jsonResponse({ email: user.email, busy }, 200, req)
  }
}
