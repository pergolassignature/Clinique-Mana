import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction, refusalMessage } from '@/core/supabase/functions'
import type { PermissionOverride, RolePermission } from './permissions'

export type UserStatus = 'active' | 'disabled'

/**
 * One row of `list_org_users`. The generated types mark every column non-null, but `role` and
 * `role_name` are null for a profile without a role, and `last_sign_in_at` for someone who never
 * signed in (left joins), so they are typed nullable here.
 */
export interface OrgUser {
  user_id: string
  display_name: string
  email: string
  /** profiles.status (check constraint: active | disabled). */
  status: UserStatus
  role: string | null
  role_name: string | null
  last_sign_in_at: string | null
  override_count: number
}

/** The caller's org users, active first then by name (users.view; raises 42501 otherwise). */
export async function fetchOrgUsers(): Promise<OrgUser[]> {
  const { data, error } = await supabase.rpc('list_org_users')
  if (error) throw error
  return data.map((row) => ({
    user_id: row.user_id,
    display_name: row.display_name,
    email: row.email,
    status: row.status as UserStatus,
    role: (row.role as string | null) ?? null,
    role_name: (row.role_name as string | null) ?? null,
    last_sign_in_at: (row.last_sign_in_at as string | null) ?? null,
    override_count: row.override_count,
  }))
}

/**
 * What each role gives by default in the caller's clinic (`org_role_permissions`, what
 * `has_permission` evaluates). Never `role_permissions`: that is the template for new clinics.
 */
export async function fetchRoleDefaults(orgId: string): Promise<RolePermission[]> {
  const { data, error } = await supabase.from('org_role_permissions').select('role, permission_key').eq('org_id', orgId)
  if (error) throw error
  return data
}

/** One user's permission overrides (RLS: users.view, same org). */
export async function fetchUserOverrides(userId: string): Promise<PermissionOverride[]> {
  const { data, error } = await supabase.from('user_permission_overrides').select('permission_key, granted').eq('user_id', userId)
  if (error) throw error
  return data
}

// The writes raise the SQL error: French P0001 messages for the guards (own account, last active
// admin, provider role, admin-only changes, permissions the caller lacks, a role that no longer
// exists: HINT role_missing).

export async function setUserRole(userId: string, role: string): Promise<void> {
  const { error } = await supabase.rpc('set_user_role', { p_user_id: userId, p_role: role })
  if (error) throw error
}

/**
 * Disables or re-enables an account through `users-set-status` (P3-9): `set_user_status` as the
 * caller (the guards above; disabling also deletes the open sessions, P3-32), then the Auth ban,
 * which refuses a new sign-in. `signinBlocked` is false when the account was disabled but the ban
 * failed: data access and the sessions have ended, and disabling again (idempotent) retries the
 * ban. A failed unban (re-enable) throws the function's `provider_error`: the account stays
 * disabled.
 */
export async function setUserStatus(userId: string, status: UserStatus): Promise<{ signinBlocked: boolean }> {
  try {
    const data = (await invokeFunction('users-set-status', { user_id: userId, status })) as { signin_blocked?: unknown } | null
    return { signinBlocked: data?.signin_blocked !== false }
  } catch (error) {
    throw asRpcRefusal(error)
  }
}

/**
 * True when « Supprimer le compte » removed the person from the app but Auth refused to delete her
 * sign-in (`users-delete`: 502 `provider_error` with `account_removed`). The same call retries it.
 */
export function isAccountRemovedError(error: unknown): boolean {
  return error instanceof FunctionCallError && error.extra.account_removed === true
}

/**
 * « Supprimer le compte » through `users-delete`: `delete_staff_account` as the caller (users.manage;
 * not oneself; disabled first; only an admin deletes an admin; a module may refuse, e.g. an account
 * linked to a professional file), then the Auth deletion. Throws the RPC's refusal as such (P0001
 * with its French message, 42501), or the function's error (`isAccountRemovedError` when only the
 * Auth deletion failed; calling again finishes it).
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  try {
    await invokeFunction('users-delete', { user_id: userId })
  } catch (error) {
    throw asRpcRefusal(error)
  }
}

export async function setPermissionOverride(userId: string, permissionKey: string, granted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_permission_override', { p_user_id: userId, p_permission_key: permissionKey, p_granted: granted })
  if (error) throw error
}

export async function clearPermissionOverride(userId: string, permissionKey: string): Promise<void> {
  const { error } = await supabase.rpc('clear_permission_override', { p_user_id: userId, p_permission_key: permissionKey })
  if (error) throw error
}

/** Removes all of the user's overrides at once (« Rétablir les permissions du rôle »); returns how many. */
export async function clearPermissionOverrides(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('clear_permission_overrides', { p_user_id: userId })
  if (error) throw error
  return data
}

// The role RPCs (roles.manage, own clinic) raise French P0001 messages for their guards: the admin
// role is never edited, base roles are never renamed or deleted, a role someone has is never
// deleted, names are unique, and a non-admin manager never gives a permission she lacks. Two carry
// a HINT the UI keys on: `role_missing` (« Ce rôle n'existe plus. »: deleted meanwhile, or another
// clinic's) and `copy_from` (create_role's copy refusal).

export async function setRolePermission(role: string, permissionKey: string, granted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_role_permission', { p_role: role, p_permission_key: permissionKey, p_granted: granted })
  if (error) throw error
}

/** Creates a custom role, empty or with a copy of `copyFrom`'s defaults; returns its key. */
export async function createRole(name: string, copyFrom: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('create_role', { p_name: name, ...(copyFrom !== null && { p_copy_from: copyFrom }) })
  if (error) throw error
  return data
}

export async function renameRole(role: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('rename_role', { p_role: role, p_name: name })
  if (error) throw error
}

export async function deleteRole(role: string): Promise<void> {
  const { error } = await supabase.rpc('delete_role', { p_role: role })
  if (error) throw error
}

// ── Staff invitations (Task 3.22) ───────────────────────────────────────────────────────────────

/**
 * One pending invitation (`list_staff_invitations`, users.view). The generated types mark every
 * column non-null, but its left joins can leave `role_name`, `expires_at` (no link),
 * `invited_by_name`, `last_email_status` and `last_email_error_code` (no email logged yet, or no
 * error) null.
 */
export interface StaffInvitation {
  id: string
  email: string
  display_name: string
  role: string
  role_name: string | null
  expires_at: string | null
  is_expired: boolean
  invited_by_name: string | null
  /** `email_log.status` of the last email about it, as `emailStatusLabel` reads it. */
  last_email_status: string | null
  /** That email's `error_code` (`provider_unavailable` reads « Résultat inconnu »). */
  last_email_error_code: string | null
}

/** The clinic's pending invitations, newest first. */
export async function listStaffInvitations(): Promise<StaffInvitation[]> {
  const { data, error } = await supabase.rpc('list_staff_invitations')
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    role_name: (row.role_name as string | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
    is_expired: row.is_expired,
    invited_by_name: (row.invited_by_name as string | null) ?? null,
    last_email_status: (row.last_email_status as string | null) ?? null,
    last_email_error_code: (row.last_email_error_code as string | null) ?? null,
  }))
}

/** Why an invitation's email did not leave: the function's code, and a 429's `Retry-After` (seconds). */
export interface EmailProblem {
  code: string
  retryAfter: number | null
}

/**
 * What « Inviter » and « Renvoyer » did: the invitation, its link's expiry (when the email left),
 * and whether its email left. `emailProblem` is set when the invitation exists (created or
 * renewed) but the email failed (`provider_error`, `not_configured`, `rate_limited`,
 * `invalid_request` for a refused recipient…).
 */
export interface InvitationSendResult {
  invitationId: string
  expiresAt: string | null
  emailProblem: EmailProblem | null
}

/**
 * The functions pass an RPC's refusal on: P0001 as 400 `invalid_request` with its French message,
 * 42501 as 403 `forbidden`. Rethrown as that RPC error (`{ code, message }`), so
 * `moduleErrorMessage` shows the message and a 42501 refreshes the caller's access, as for the
 * RPCs called directly. Anything else (a 400 naming a `field`, a function's own code) stays as it
 * is.
 */
function asRpcRefusal(error: unknown): unknown {
  if (!(error instanceof FunctionCallError)) return error
  const refusal = refusalMessage(error)
  if (refusal !== null) return { code: 'P0001', message: refusal }
  if (error.status === 403 && error.code === 'forbidden') return { code: '42501', message: error.message }
  return error
}

/** `staff-invite`: the invitation, or its refusal; an error answer that names the invitation means only the email failed. */
async function sendInvitation(body: Record<string, unknown>): Promise<InvitationSendResult> {
  try {
    const data = (await invokeFunction('staff-invite', body)) as { invitation_id: string; expires_at?: unknown }
    const expiresAt = typeof data.expires_at === 'string' ? data.expires_at : null
    return { invitationId: data.invitation_id, expiresAt, emailProblem: null }
  } catch (error) {
    const invitationId = error instanceof FunctionCallError ? error.extra.invitation_id : undefined
    if (error instanceof FunctionCallError && typeof invitationId === 'string') {
      return { invitationId, expiresAt: null, emailProblem: { code: error.code, retryAfter: error.retryAfter } }
    }
    throw asRpcRefusal(error)
  }
}

/**
 * « Inviter » (users.manage): through `staff-invite` only. The function creates the invitation as
 * the caller (`create_staff_invitation` is service-role only, P3-7) and emails the link; the
 * browser never sees a token. Throws the RPC's refusal (P0001: provider role, admin by a
 * non-admin, hold rule, already a member, already pending) or the function's.
 */
export function inviteStaff(input: { email: string; displayName: string; role: string }): Promise<InvitationSendResult> {
  return sendInvitation({ email: input.email, display_name: input.displayName, role: input.role })
}

/** « Renvoyer »: a new link by email (`renew_staff_invitation` through `staff-invite`); the previous link stops working. */
export function resendInvitation(invitationId: string): Promise<InvitationSendResult> {
  return sendInvitation({ invitation_id: invitationId })
}

/** « Révoquer » (users.manage): the invitation and its link (P0001 when it is no longer pending). */
export async function revokeInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_staff_invitation', { p_id: invitationId })
  if (error) throw error
}
