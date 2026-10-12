/**
 * `gmail-connect` (plan §11, CM1): the start of a mailbox's connection, and
 * its disconnection. User function: `verifyAuth` with module
 * `communications` and `communications.mailboxes_manage`.
 *
 * `{ action: 'start', kind?: 'shared' | 'personal' }` → `{ url }`, Google's
 * consent page for the clinic's OAuth application (the two org secrets set
 * in « Courriels Gmail »; none → 503 `not_configured`): scopes
 * `gmail.modify` and `gmail.send` only, `access_type=offline` and
 * `prompt=consent` (a refresh token every time), the fixed redirect URI
 * (`APP_URL` + `/courriels/retour-google`; a missing or non-https `APP_URL`
 * → 500), and a **signed state** (`_shared/oauth-state.ts`: the clinic, the
 * person, a nonce, 10 minutes, the kind). The browser then goes to Google;
 * `gmail-callback` finishes the flow. PS Hub's state was unsigned base64
 * with a client-chosen return origin (roadmap §2.4 bis): fixed.
 *
 * `{ action: 'disconnect', connection_id }` → `{ ok: true, revoked }`: the
 * watch is stopped and the grant revoked at Google (best effort: Google's
 * side may already be gone), then `disconnect_mail_connection` (the actor
 * model: the RPC re-checks the caller) deletes the tokens and marks the row
 * `disconnected`; the mirror stays. An unknown or already disconnected
 * mailbox → 404.
 *
 * One hit on `LIMITS.gmailConnectUser` (20 an hour per caller) for either.
 *
 * Status mapping: 200; 400 `invalid_request` (body); 401 / 403 / 503 from
 * `verifyAuth`; 403 `module_disabled`; 404 `not_found`; 405; 413; 429
 * `rate_limited`; 500 `server_misconfigured` (no usable `APP_URL`, no
 * `INTERNAL_FUNCTION_SECRET`) / `internal` (reported); 503 `not_configured`
 * (the OAuth application is not set).
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
import { GmailClient, GmailError } from '../_shared/gmail/client.ts'
import { oauthApp, revokeToken } from '../_shared/gmail/credentials.ts'
import {
  GMAIL_SCOPES,
  gmailOrigins,
  redirectUri,
} from '../_shared/gmail/env.ts'
import { readJson } from '../_shared/http.ts'
import { signState } from '../_shared/oauth-state.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'gmail-connect'
/** The state's purpose (checked by `gmail-callback`). */
export const STATE_PURPOSE = 'gmail_connect'

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('start'),
    kind: z.enum(['shared', 'personal']).default('shared'),
  }),
  z.strictObject({ action: z.literal('disconnect'), connection_id: z.guid() }),
])

const credentialsSchema = z.array(z.object({
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
      module: 'communications',
      permission: 'communications.mailboxes_manage',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, 2_048)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.gmailConnectUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

    const origins = gmailOrigins(deps.env)

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
      const { state } = await signState(secret, {
        purpose: STATE_PURPOSE,
        orgId,
        userId: auth.user.id,
        data: { kind: input.kind },
      }, deps.now())
      const url = new URL(`${origins.accountsPublic}/o/oauth2/v2/auth`)
      url.searchParams.set('client_id', app.clientId)
      url.searchParams.set('redirect_uri', redirect)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', GMAIL_SCOPES.join(' '))
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
      url.searchParams.set('include_granted_scopes', 'false')
      url.searchParams.set('state', state)
      return jsonResponse({ url: url.toString() }, 200, req)
    }

    // Disconnect: Google first (best effort), then the database.
    ids.connection_id = input.connection_id
    const read = await service.rpc('get_mail_connection_credentials', {
      p_org_id: orgId,
      p_connection_id: input.connection_id,
    })
    const credentials = credentialsSchema.safeParse(read.data)
    if (read.error || !credentials.success) {
      await report('credentials_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    let revoked = false
    const row = credentials.data[0]
    if (row) {
      const gmail = new GmailClient({
        fetch: deps.fetch,
        origin: origins.api,
        accessToken: row.access_token,
        signal: req.signal,
      })
      try {
        await gmail.stop()
      } catch (error) {
        if (!(error instanceof GmailError)) throw error
      }
      revoked = await revokeToken(deps.fetch, origins, row.refresh_token)
    }
    const done = await service.rpc('disconnect_mail_connection', {
      p_actor: auth.user.id,
      p_org_id: orgId,
      p_connection_id: input.connection_id,
    })
    if (done.error) {
      if (done.error.code === '42501' || done.error.code === 'P0001') {
        return rpcErrorResponse(done.error, req)
      }
      await report('disconnect_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (done.data !== true) {
      return errorResponse('not_found', 'Mailbox not found', 404, req)
    }
    return jsonResponse({ ok: true, revoked }, 200, req)
  }
}
