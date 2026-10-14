/**
 * `gmail-callback` (plan §11, CM1): the end of a mailbox's connection. The
 * app's return page (`/courriels/retour-google`, where Google sent the
 * browser with `?code=&state=`) posts both here **with the person's own
 * session**: user function, `verifyAuth` with module `communications` and
 * `communications.mailboxes_manage`. So a callback is accepted only from the
 * signed-in person the state names, in her clinic (PS Hub's callback had no
 * user and trusted the state's user id, roadmap §2.4 bis).
 *
 * 1. Body `{ code, state }`, strict.
 * 2. One hit on `LIMITS.gmailCallbackUser` (20 an hour per caller).
 * 3. The state (`verifyState`: the MAC, 10 minutes, the purpose): malformed
 *    or forged → 410 `link_invalid`; expired → 410 `link_expired`; another
 *    clinic or person → 403 `forbidden`.
 * 4. The nonce spent once (`spendStateNonce`, kept until the state expires):
 *    a replayed state → 410 `link_used`; the check unavailable → 503.
 * 5. The code exchanged at Google's token endpoint with the clinic's OAuth
 *    application (none → 503 `not_configured`): a refused code → 400 with a
 *    French refusal (« Google a refusé… recommencez »); Google down → 502.
 * 6. The grant must carry `gmail.modify` (a scope unticked at consent) →
 *    400 refusal; `users.getProfile` names the mailbox (lower case).
 * 7. `store_mail_connection` (the actor model: the RPC re-checks the
 *    caller; a personal mailbox of someone else → its P0001, passed on):
 *    the connection, its tokens encrypted, a fresh sync state with a sync
 *    requested. The app then calls `gmail-sync` for the first pass.
 * 8. 200 `{ connection_id, email_address }`. The tokens never reach the
 *    browser, a log or a report.
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
import { GmailClient, GmailError } from '../_shared/gmail/client.ts'
import { exchangeCode, oauthApp } from '../_shared/gmail/credentials.ts'
import {
  gmailOrigins,
  redirectUri,
  REQUIRED_SCOPE,
} from '../_shared/gmail/env.ts'
import { readJson } from '../_shared/http.ts'
import { spendStateNonce, verifyState } from '../_shared/oauth-state.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'gmail-callback'
const STATE_PURPOSE = 'gmail_connect'

const bodySchema = z.strictObject({
  code: z.string().min(1).max(512),
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
      module: 'communications',
      permission: 'communications.mailboxes_manage',
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
      await consume(service, LIMITS.gmailCallbackUser, [orgId, auth.user.id]),
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
    // Shared mailboxes only (CM-10); the RPC refuses any other kind too.
    const kind = 'shared'

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
        'Google OAuth client is not set',
        503,
        req,
      )
    }

    const origins = gmailOrigins(deps.env)
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
          'Google a refusé le code de connexion. Recommencez la connexion de la boîte.',
          req,
        )
      }
      await report(
        error instanceof GmailError ? `token_${error.code}` : 'token_failed',
      )
      return errorResponse('provider_error', 'Google unavailable', 502, req)
    }
    const scopes = (token.scope ?? '').split(' ').filter(Boolean)
    if (!scopes.includes(REQUIRED_SCOPE) || !token.refresh_token) {
      return refusalResponse(
        'Les accès demandés n’ont pas tous été accordés. Recommencez et acceptez chaque accès proposé par Google.',
        req,
      )
    }
    let profile
    try {
      profile = await new GmailClient({
        fetch: deps.fetch,
        origin: origins.api,
        accessToken: token.access_token,
        signal: req.signal,
      }).getProfile()
    } catch (error) {
      await report(
        error instanceof GmailError
          ? `profile_${error.code}`
          : 'profile_failed',
      )
      return errorResponse('provider_error', 'Google unavailable', 502, req)
    }
    const expiresAt = new Date(
      deps.now().getTime() + (token.expires_in ?? 3_600) * 1000,
    )
    const stored = await service.rpc('store_mail_connection', {
      p_actor: auth.user.id,
      p_org_id: orgId,
      p_email_address: profile.emailAddress.trim().toLowerCase(),
      p_kind: kind,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token,
      p_access_token_expires_at: expiresAt.toISOString(),
      p_scopes: scopes,
    })
    if (stored.error) {
      if (['P0001', '42501', '22023'].includes(stored.error.code ?? '')) {
        return rpcErrorResponse(stored.error, req)
      }
      await report('store_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (typeof stored.data !== 'string') {
      await report('store_unusable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    return jsonResponse(
      {
        connection_id: stored.data,
        email_address: profile.emailAddress.trim().toLowerCase(),
      },
      200,
      req,
    )
  }
}
