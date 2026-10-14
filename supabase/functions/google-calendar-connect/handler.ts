/**
 * `google-calendar-connect` (R6): the start of a professional's Google busy-time
 * connection, and its end. User function: `verifyAuth` with module
 * `appointments` and `appointments.self` (her own account only; the RPCs
 * re-check that she is a professional of the clinic).
 *
 * `{ action: 'start' }` → `{ url }`: Google's consent page for the clinic's
 * Google application (the calendars' own, else Gmail's: `calendarOAuthApp`, AP-46; none → 503
 * `not_configured`), the
 * scopes `openid email calendar.freebusy` (AP-41), offline access with the
 * consent screen (so a refresh token comes back), the fixed redirect URI
 * (`APP_URL` + `/mon-agenda/agenda-google`) and a **signed state**
 * (`_shared/oauth-state.ts`: the clinic, the person, a nonce, 10 minutes).
 *
 * `{ action: 'disconnect' }` → `{ ok: true, revoked }`: the grant revoked at
 * Google (best effort), then `disconnect_my_calendar_connection` deletes the
 * tokens and the busy times. Nothing connected → 404.
 *
 * One hit on `LIMITS.googleCalendarConnectUser` (20 an hour per caller).
 *
 * Status mapping: 200; 400 `invalid_request` (body, or a refusal with
 * `refusal: true`); 401 / 403 / 503 from `verifyAuth`; 404 `not_found`; 405;
 * 413; 429; 500 `server_misconfigured` / `internal` (reported); 503
 * `not_configured` (the Google application is not set).
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
import { revokeToken } from '../_shared/gmail/credentials.ts'
import { calendarOAuthApp } from '../_shared/google-calendar/credentials.ts'
import {
  CALENDAR_SCOPES,
  calendarOrigins,
  redirectUri,
} from '../_shared/google-calendar/env.ts'
import { readJson } from '../_shared/http.ts'
import { signState } from '../_shared/oauth-state.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'google-calendar-connect'
/** The state's purpose (checked by `google-calendar-callback`). */
export const STATE_PURPOSE = 'google_calendar_connect'

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start') }),
  z.strictObject({ action: z.literal('disconnect') }),
])

const credentialsSchema = z.array(
  z.object({
    connection_id: z.string(),
    access_token: z.string(),
    refresh_token: z.string(),
  }).loose(),
).max(1)

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
      await consume(service, LIMITS.googleCalendarConnectUser, [
        orgId,
        auth.user.id,
      ]),
      req,
    )
    if (limited) return limited

    const origins = calendarOrigins(deps.env)
    let app
    try {
      app = await calendarOAuthApp(service, orgId)
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
          'Google app is not set',
          503,
          req,
        )
      }
      const { state } = await signState(secret, {
        purpose: STATE_PURPOSE,
        orgId,
        userId: auth.user.id,
      }, deps.now())
      const url = new URL(`${origins.accountsPublic}/o/oauth2/v2/auth`)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', app.clientId)
      url.searchParams.set('redirect_uri', redirect)
      url.searchParams.set('scope', CALENDAR_SCOPES.join(' '))
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
      url.searchParams.set('include_granted_scopes', 'false')
      url.searchParams.set('state', state)
      return jsonResponse({ url: url.toString() }, 200, req)
    }

    // Disconnect: Google first (best effort), then the database.
    const read = await service.rpc('get_my_calendar_credentials_for_service', {
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
      revoked = await revokeToken(deps.fetch, origins, row.refresh_token)
    }
    const done = await service.rpc('disconnect_my_calendar_connection', {
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
