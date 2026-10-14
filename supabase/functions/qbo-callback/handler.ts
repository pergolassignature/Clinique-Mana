/**
 * `qbo-callback` (plan §8, FQ): the end of the QuickBooks connection. The
 * app's return page (`/facturation/retour-quickbooks`, where Intuit sent the
 * browser with `?code=&state=&realmId=`) posts the three here **with the
 * person's own session**: user function, `verifyAuth` with module `billing`
 * and `billing.settings`. PS Hub's callback had no user, trusted an unsigned
 * state and wrote the realm as given (roadmap §2.6).
 *
 * 1. Body `{ code, state, realm_id }`, strict (the realm: digits).
 * 2. One hit on `LIMITS.qboCallbackUser` (20 an hour per caller).
 * 3. The state (`verifyState`: the MAC, 10 minutes, the purpose): forged →
 *    410 `link_invalid`; expired → 410 `link_expired`; another clinic or
 *    person → 403 `forbidden`; the nonce spent once → a replay is 410
 *    `link_used`.
 * 4. The code exchanged with the clinic's Intuit application (none → 503
 *    `not_configured`): a refused code → 400 French refusal; Intuit down →
 *    502.
 * 5. `companyinfo` with the new token in the state's environment: the realm
 *    is the one the token opens (a refusal → 400 French refusal); its name.
 * 6. `store_qbo_connection` (the actor re-checked; another company while
 *    one is connected → its P0001, passed on, and the new grant revoked).
 * 7. 200 `{ connection_id, company_name }`. The app then calls `qbo-sync`.
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
import { QboClient, QboError } from '../_shared/qbo/client.ts'
import {
  exchangeCode,
  oauthApp,
  revokeToken,
  tokenExpiries,
} from '../_shared/qbo/credentials.ts'
import {
  QBO_ENVIRONMENTS,
  type QboEnvironment,
  qboOrigins,
  redirectUri,
} from '../_shared/qbo/env.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'qbo-callback'
const STATE_PURPOSE = 'qbo_connect'

const bodySchema = z.strictObject({
  code: z.string().min(1).max(512),
  state: z.string().min(1).max(2_048),
  realm_id: z.string().regex(/^[0-9]{1,32}$/),
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
      module: 'billing',
      permission: 'billing.settings',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, 4_096)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const report = (code: string) =>
      reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.qboCallbackUser, [orgId, auth.user.id]),
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
    const environment = state.data?.environment as QboEnvironment | undefined
    if (
      !environment ||
      !(QBO_ENVIRONMENTS as readonly string[]).includes(environment)
    ) {
      return errorResponse('link_invalid', 'State invalid', 410, req)
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
      return errorResponse(
        'not_configured',
        'Intuit application is not set',
        503,
        req,
      )
    }

    const origins = qboOrigins(deps.env)
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
      if (error instanceof QboError && error.code === 'validation') {
        return refusalResponse(
          'Intuit a refusé le code de connexion. Recommencez la connexion à QuickBooks.',
          req,
        )
      }
      await report(
        error instanceof QboError ? `token_${error.code}` : 'token_failed',
      )
      return errorResponse('provider_error', 'Intuit unavailable', 502, req)
    }
    const revokeNew = () =>
      revokeToken(deps.fetch, origins, app, token.refresh_token)

    let companyName: string | null
    try {
      companyName = await new QboClient({
        fetch: deps.fetch,
        origin: origins.api(environment),
        realmId: input.realm_id,
        accessToken: token.access_token,
        signal: req.signal,
      }).companyName()
    } catch (error) {
      if (
        error instanceof QboError &&
        ['unauthorized', 'forbidden', 'not_found', 'validation'].includes(
          error.code,
        )
      ) {
        await revokeNew()
        return refusalResponse(
          'QuickBooks n’a pas ouvert cette entreprise avec cette connexion. Vérifiez l’environnement choisi (production ou bac à sable), puis recommencez.',
          req,
        )
      }
      await report(
        error instanceof QboError ? `company_${error.code}` : 'company_failed',
      )
      return errorResponse('provider_error', 'Intuit unavailable', 502, req)
    }

    const expiries = tokenExpiries(token, deps.now())
    const stored = await service.rpc('store_qbo_connection', {
      p_actor: auth.user.id,
      p_org_id: orgId,
      p_realm_id: input.realm_id,
      p_environment: environment,
      p_company_name: companyName,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token,
      p_access_token_expires_at: expiries.access.toISOString(),
      p_refresh_token_expires_at: expiries.refresh?.toISOString() ?? null,
    })
    if (stored.error) {
      await revokeNew()
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
      { connection_id: stored.data, company_name: companyName },
      200,
      req,
    )
  }
}
