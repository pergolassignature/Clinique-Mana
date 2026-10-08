import { supabase } from '@/core/supabase/client'
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

export interface CatalogPermission {
  key: string
  module_key: string
  /** French, shown as is. */
  description: string
}

export interface PermissionCatalog {
  permissions: CatalogPermission[]
  rolePermissions: RolePermission[]
  roles: { key: string; name: string }[]
  modules: { key: string; name: string }[]
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

/** The permission catalogue, readable by every authenticated user: permissions, role defaults, roles, modules. */
export async function fetchPermissionCatalog(): Promise<PermissionCatalog> {
  const [permissions, rolePermissions, roles, modules] = await Promise.all([
    supabase.from('permissions').select('key, module_key, description'),
    supabase.from('role_permissions').select('role, permission_key'),
    supabase.from('roles').select('key, name'),
    supabase.from('modules').select('key, name'),
  ])
  for (const result of [permissions, rolePermissions, roles, modules]) if (result.error) throw result.error
  return {
    permissions: permissions.data ?? [],
    rolePermissions: rolePermissions.data ?? [],
    roles: roles.data ?? [],
    modules: modules.data ?? [],
  }
}

/** One user's permission overrides (RLS: users.view, same org). */
export async function fetchUserOverrides(userId: string): Promise<PermissionOverride[]> {
  const { data, error } = await supabase.from('user_permission_overrides').select('permission_key, granted').eq('user_id', userId)
  if (error) throw error
  return data
}

// The writes raise the SQL error: French P0001 messages for the guards (own account, last active
// admin, provider role, admin-only changes, permissions the caller lacks).

export async function setUserRole(userId: string, role: string): Promise<void> {
  const { error } = await supabase.rpc('set_user_role', { p_user_id: userId, p_role: role })
  if (error) throw error
}

export async function setUserStatus(userId: string, status: UserStatus): Promise<void> {
  const { error } = await supabase.rpc('set_user_status', { p_user_id: userId, p_status: status })
  if (error) throw error
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
