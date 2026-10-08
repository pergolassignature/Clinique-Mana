/**
 * `professionals-set-status` (Task 4b.6, P4-380, P4-381): « Activer »,
 * « Réactiver » and « Désactiver » on a professional's file, and « Réessayer »
 * when the sign-in block did not follow.
 *
 * A deactivation whose reason disables the account (« Fin de collaboration »,
 * P4-11) disables the provider's profile and, in the same transaction,
 * deletes their Auth sessions: open sessions end at once and their refresh
 * tokens are gone (P3-32; any other disable does it too, trigger
 * `profiles_end_sessions_on_disable`, P4-380). Data access stops with the
 * profile's status. This function then bans the account in Auth, so a
 * password sign-in is refused as well, as `users-set-status` does in
 * « Utilisateurs ». A reactivation that re-enables the account lifts the ban.
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `professionals` and
 *    `professionals.manage`.
 * 2. Body: `{ action: 'deactivate', professional_id, reason_id, note? }`,
 *    `{ action: 'activate', professional_id, override_reason? }` or
 *    `{ action: 'sync_signin', professional_id }`. Any other field (a profile
 *    id, an org) is ignored: the account comes from the RPC.
 * 3. The service client before any change: a misconfigured one must not leave
 *    an account disabled without the ban.
 * 4. `deactivate_professional` / `activate_professional` with the **caller's**
 *    client: every guard of 4a.4 decides, as the caller. They answer
 *    `(status, account_change, profile_id)`: `account_change` is `disabled`
 *    or `enabled` only when this call changed the provider's account, which
 *    they do only for a profile holding the role `provider`. Auth is called
 *    only then, for that profile only.
 * 5. With the service client, `auth.admin.updateUserById(profile_id,
 *    { ban_duration })`: `876000h` (100 years) to disable, `none` to enable.
 * 6. 200 `{ status, account_change, profile_id, signin_synced }`.
 *    `signin_synced` is false when Auth refused the ban or the unban (P4-381):
 *    the status change stands (a deactivation has ended the sessions and data
 *    access, that is the safe side; a reactivation's account is active but
 *    Auth still refuses its sign-in), the failure is reported, and the UI
 *    offers « Réessayer », which sends `sync_signin`. Not a 502 as in
 *    `users-set-status`, whose failed re-enable is rolled back: here the
 *    file's status has changed and must be shown.
 * 7. `sync_signin`: `get_professional_account_status` as the caller (the
 *    provider account linked to the file, `professionals.manage`), then the
 *    ban that follows its status: `disabled` → banned, `active` → not. Always
 *    attempted, so a retry never depends on what the previous call did. 200
 *    `{ account_status, signin_synced }`; no account → `{ account_status:
 *    null, signin_synced: true }`.
 *
 * Status mapping: 200; 400 `invalid_request` (body; P0001 with its French
 * message, flagged `refusal`, its HINT as `field`: `status`, `readiness`,
 * `reason`, `note`; 22023); 401 / 403 / 503 from `verifyAuth` (403
 * `module_disabled` with the module off); 403 `forbidden` (42501); 405; 409
 * `conflict` (40001: the account was linked or unlinked meanwhile, « Le
 * dossier vient de changer. Réessayez. »); 413; 500 `internal` (another RPC
 * error or an unexpected answer, reported) or `server_misconfigured`.
 * Reports carry the org, professional and user ids only.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { readJson } from '../_shared/http.ts'
import {
  isExpectedRpcError,
  professionalsRpcError,
  type RpcError,
} from '../_shared/professionals.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'professionals-set-status'

/** A ban long enough to be permanent; `none` lifts it (as `users-set-status`). */
const BAN_FOREVER = '876000h'

// guid, not uuid: seed and fixture ids are not RFC 4122 variants. The texts are
// bounded here only against abuse; their rules (1–500 characters) are the RPCs'.
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('deactivate'),
    professional_id: z.guid(),
    reason_id: z.guid(),
    note: z.string().max(5000).nullable().optional(),
  }),
  z.object({
    action: z.literal('activate'),
    professional_id: z.guid(),
    override_reason: z.string().max(5000).optional(),
  }),
  z.object({ action: z.literal('sync_signin'), professional_id: z.guid() }),
])

/** The status RPCs' one row (4a.4). */
const statusRowsSchema = z.tuple([
  z.object({
    status: z.enum(['active', 'inactive']),
    account_change: z.enum(['disabled', 'enabled']).nullable(),
    profile_id: z.guid().nullable(),
  }),
]).refine(([row]) => (row.account_change === null) || row.profile_id !== null)

/** `get_professional_account_status`: none or one row. */
const accountRowsSchema = z.array(z.object({
  profile_id: z.guid(),
  account_status: z.enum(['active', 'disabled']),
})).max(1)

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
      { module: 'professionals', permission: 'professionals.manage' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const ids = {
      org_id: auth.access.org_id,
      professional_id: input.professional_id,
    }
    const report = (code: string, extra: Record<string, string> = {}) =>
      reportError({ fn: FN, code, ids: { ...ids, ...extra } }, deps.fetch)

    /** The RPC's refusal as the app reads it; anything unexpected reported. */
    const refused = async (error: RpcError, code: string) => {
      if (error.code === '40001') {
        return errorResponse('conflict', 'Record changed', 409, req)
      }
      if (!isExpectedRpcError(error)) await report(code)
      return professionalsRpcError(error, req)
    }

    /** The Auth ban for the account; true once Auth applied it. */
    const ban = async (
      userId: string,
      banned: boolean,
      failure: string,
    ): Promise<boolean> => {
      const { error } = await service.auth.admin.updateUserById(userId, {
        ban_duration: banned ? BAN_FOREVER : 'none',
      })
      if (error) await report(failure, { user_id: userId })
      return !error
    }

    if (input.action === 'sync_signin') {
      const read = await auth.client.rpc('get_professional_account_status', {
        p_id: input.professional_id,
      })
      if (read.error) return await refused(read.error, 'account_read_failed')
      const rows = accountRowsSchema.safeParse(read.data)
      if (!rows.success) {
        await report('account_invalid')
        return errorResponse('internal', 'Unexpected answer', 500, req)
      }
      const [account] = rows.data
      if (!account) {
        return jsonResponse(
          { account_status: null, signin_synced: true },
          200,
          req,
        )
      }
      const synced = await ban(
        account.profile_id,
        account.account_status === 'disabled',
        'auth_sync_failed',
      )
      return jsonResponse(
        { account_status: account.account_status, signin_synced: synced },
        200,
        req,
      )
    }

    const changed = input.action === 'deactivate'
      ? await auth.client.rpc('deactivate_professional', {
        p_id: input.professional_id,
        p_reason_id: input.reason_id,
        ...(input.note != null && { p_note: input.note }),
      })
      : await auth.client.rpc('activate_professional', {
        p_id: input.professional_id,
        ...(input.override_reason !== undefined &&
          { p_override_reason: input.override_reason }),
      })
    if (changed.error) return await refused(changed.error, 'status_failed')
    const rows = statusRowsSchema.safeParse(changed.data)
    if (!rows.success) {
      await report('status_invalid')
      return errorResponse('internal', 'Unexpected answer', 500, req)
    }
    const [row] = rows.data
    let synced = true
    if (row.account_change !== null && row.profile_id !== null) {
      const disabled = row.account_change === 'disabled'
      synced = await ban(
        row.profile_id,
        disabled,
        disabled ? 'auth_ban_failed' : 'auth_unban_failed',
      )
    }
    return jsonResponse(
      {
        status: row.status,
        account_change: row.account_change,
        profile_id: row.profile_id,
        signin_synced: synced,
      },
      200,
      req,
    )
  }
}
