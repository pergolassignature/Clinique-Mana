/**
 * `users-delete`: « Supprimer le compte » in « Utilisateurs et accès ». The
 * account must be disabled first (`users-set-status`: its sessions ended, its
 * sign-in banned); this removes it from the app, then from Auth.
 *
 * 1. CORS; `POST` only; `verifyAuth` with `users.manage`.
 * 2. Body `{ user_id }`. Any other field (an org, an actor) is ignored: the
 *    org is the caller's (`delete_staff_account` reads it from her session).
 * 3. `users.delete_user` (20 per hour per caller).
 * 4. `delete_staff_account` with the **caller's** client: every guard
 *    decides as the caller (users.manage, not herself, her clinic only, only
 *    an admin deletes an admin, disabled first, a module's refusal such as an
 *    account linked to a professional file). It deletes the app rows and
 *    records the non-identifying audit trace, then answers `deleted`, or
 *    `already_deleted` for an account this clinic already deleted (the retry
 *    of a failed Auth deletion). Auth is called only once it succeeded, so a
 *    refused call never touches Auth.
 * 5. With the service client, `auth.admin.deleteUser(user_id)`. Auth's « not
 *    found » counts as done (an earlier attempt, or the purge, got there
 *    first).
 * 6. Auth deletion failed: the app rows are already gone (the person has no
 *    access left, and her sign-in was banned when she was disabled). Reported
 *    (`auth_delete_failed`, ids only) and answered 502 `provider_error` with
 *    `account_removed: true`: the UI offers « Réessayer », which is the same
 *    call (step 4 answers `already_deleted`, step 5 runs again). Nobody
 *    retrying: the job `core.invite_orphans_purge` deletes that Auth user an
 *    hour later.
 *
 * Status mapping: 200 `{ status: 'deleted' }`; 400 `invalid_request` (body;
 * P0001 with its French message, `refusal: true`; 22023); 401 / 403 / 503
 * from `verifyAuth`; 403 `forbidden` (42501); 405; 413; 429 `rate_limited`
 * with `Retry-After`; 503 `not_configured` (limiter failed closed); 502
 * `provider_error` (Auth deletion failed, see 6); 500 `internal` (another RPC
 * error or an unexpected answer, reported) or `server_misconfigured`. Logs
 * and reports carry the org and user ids only, never an address or a name.
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
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'users-delete'

const bodySchema = z.object({ user_id: z.guid() })

const outcomeSchema = z.enum(['deleted', 'already_deleted'])

/** Auth's answer for a user that no longer exists. */
function isUserGone(error: { status?: number; code?: string }): boolean {
  return error.status === 404 || error.code === 'user_not_found'
}

/** The delete handler; see the module comment. */
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
    // app rows deleted without an Auth attempt.
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const orgId = auth.access.org_id
    const ids = { org_id: orgId, user_id: input.user_id }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const refused = limitResponse(
      await consume(service, LIMITS.usersDeleteUser, [orgId, auth.user.id]),
      req,
    )
    if (refused) return refused

    const deleted = await auth.client.rpc('delete_staff_account', {
      p_user_id: input.user_id,
    })
    if (deleted.error) {
      if (!['P0001', '42501', '22023'].includes(deleted.error.code ?? '')) {
        await report('delete_failed')
      }
      return rpcErrorResponse(deleted.error, req)
    }
    if (!outcomeSchema.safeParse(deleted.data).success) {
      await report('delete_unexpected')
      return errorResponse('internal', 'Account deletion failed', 500, req)
    }

    const { error } = await service.auth.admin.deleteUser(input.user_id)
    if (error && !isUserGone(error)) {
      await report('auth_delete_failed')
      return jsonResponse(
        {
          error: {
            code: 'provider_error',
            message: 'Account removed from the app, sign-in not deleted',
          },
          account_removed: true,
        },
        502,
        req,
      )
    }
    return jsonResponse({ status: 'deleted' }, 200, req)
  }
}
