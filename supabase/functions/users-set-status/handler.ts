/**
 * `users-set-status` (Task 3.20, design §4, P3-9): « Désactiver » and
 * « Réactiver » in « Utilisateurs et accès ». Disabling also bans the
 * account in Auth, which refuses its token refreshes, so open sessions end
 * when their access token expires (an hour at most, ADR 0006); data access
 * stops at once through the profile's status. Re-enabling lifts the ban.
 *
 * 1. CORS; `POST` only; `verifyAuth` with `users.manage`.
 * 2. Body `{ user_id, status: 'active' | 'disabled' }`.
 * 3. `set_user_status` with the **caller's** client: every Phase 2 guard
 *    (same org, admin rules, the last admin) decides, as the caller. Auth is
 *    called only once it succeeded, so a refused change never touches Auth.
 * 4. With the service client, `auth.admin.updateUserById(user_id,
 *    { ban_duration })`: `876000h` (100 years) to disable, `none` to enable.
 * 5. Disable, ban failed: the disable stays (data access has stopped; that is
 *    the safe side), 200 `{ status, sessions_ended: false }`, reported; the
 *    UI warns that open sessions close within the hour.
 * 6. Enable, unban failed: a still-banned person cannot sign in, so the
 *    status is put back to `disabled` (as the caller), and the answer is 502
 *    `provider_error` (« Réessayez »). The database never shows an account
 *    as active while Auth refuses it. A failed roll-back is reported too.
 *
 * Status mapping: 200 `{ status: 'disabled', sessions_ended }` or
 * `{ status: 'active' }`; 400 `invalid_request` (body; P0001 with its French
 * message; 22023); 401 / 403 / 503 from `verifyAuth`; 403 `forbidden`
 * (42501); 405; 413; 502 `provider_error` (unban failed); 500 `internal`
 * (another RPC error, reported) or `server_misconfigured`. Reports carry the
 * org and user ids only.
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
import { reportError } from '../_shared/report.ts'

const FN = 'users-set-status'

/** A ban long enough to be permanent; `none` lifts it. */
const BAN_FOREVER = '876000h'

const bodySchema = z.object({
  user_id: z.guid(),
  status: z.enum(['active', 'disabled']),
})

/** The status handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { permission: 'users.manage' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    // Before any change: a misconfigured service client must not leave the
    // status changed without the ban.
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const ids = { org_id: auth.access.org_id, user_id: input.user_id }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)
    const setStatus = (status: 'active' | 'disabled') =>
      auth.client.rpc('set_user_status', {
        p_user_id: input.user_id,
        p_status: status,
      })

    const changed = await setStatus(input.status)
    if (changed.error) {
      if (!['P0001', '42501', '22023'].includes(changed.error.code ?? '')) {
        await report('set_status_failed')
      }
      return rpcErrorResponse(changed.error, req)
    }

    const disable = input.status === 'disabled'
    const { error } = await service.auth.admin.updateUserById(input.user_id, {
      ban_duration: disable ? BAN_FOREVER : 'none',
    })
    if (disable) {
      if (error) await report('auth_ban_failed')
      return jsonResponse(
        { status: 'disabled', sessions_ended: !error },
        200,
        req,
      )
    }
    if (error) {
      await report('auth_unban_failed')
      const rollback = await setStatus('disabled')
      if (rollback.error) await report('status_rollback_failed')
      return errorResponse(
        'provider_error',
        'Account could not be re-enabled',
        502,
        req,
      )
    }
    return jsonResponse({ status: 'active' }, 200, req)
  }
}
