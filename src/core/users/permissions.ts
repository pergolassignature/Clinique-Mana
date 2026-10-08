/**
 * Permission helpers for « Utilisateurs et accès ». They mirror the database
 * (`private.has_permission` and the guards of `20261007211509_core_user_admin.sql` and
 * `20261008015825_core_editable_roles.sql`) so the UI hides what the server would refuse; the
 * server still decides, and its message is shown if it does.
 */

/** A user's stance on one permission: the role's default, or an override either way. */
export type OverrideState = 'role' | 'granted' | 'revoked'

export interface RolePermission {
  role: string
  permission_key: string
}

export interface PermissionOverride {
  permission_key: string
  granted: boolean
}

/** The base roles managed here; `provider` is owned by the Professionnels module (decision #28). */
export const MANAGED_ROLES = ['admin', 'counselor', 'admin_assistant'] as const

/** The role given by the Professionnels module only: never offered, never assigned here. */
export const PROVIDER_ROLE = 'provider'

/** A clinic's own role (decision #40): renamed and deleted here. Base roles have no org. */
export function isCustomRole(role: { org_id: string | null }): boolean {
  return role.org_id !== null
}

/** Menu and matrix order of the base roles; the custom roles follow, by name. */
const ROLE_ORDER = ['admin', 'counselor', 'admin_assistant', 'provider']

/** What the role gives by default. */
export function roleGrants(role: string | null, rolePermissions: RolePermission[]): Set<string> {
  return new Set(rolePermissions.filter((rp) => rp.role === role).map((rp) => rp.permission_key))
}

/** The user's override on `key`, or `role` when there is none. */
export function overrideStateOf(key: string, overrides: PermissionOverride[]): OverrideState {
  const override = overrides.find((o) => o.permission_key === key)
  if (!override) return 'role'
  return override.granted ? 'granted' : 'revoked'
}

interface CallerLimits {
  callerIsAdmin: boolean
  /** The caller's own effective permissions (`useAccess().can`). */
  callerCan: (key: string) => boolean
}

/** What one permission switch shows: the override's value if there is one, else the role default. */
export function effectivePermission(key: string, byRole: boolean, overrides: PermissionOverride[]): { on: boolean; override: boolean | null } {
  const override = overrides.find((o) => o.permission_key === key)?.granted ?? null
  return { on: override ?? byRole, override }
}

/** What turning a switch to `next` saves: back to the role value clears the override (decision #39). */
export function stateForSwitch(byRole: boolean, next: boolean): OverrideState {
  if (next === byRole) return 'role'
  return next ? 'granted' : 'revoked'
}

/**
 * Whether the caller may flip one permission of another user. Turning it off (a revoke, or a
 * cleared grant) is always allowed; a non-admin manager turns it on (a grant, or a cleared revoke
 * back to a role « Oui ») only if they hold it.
 */
export function canTogglePermission({ callerIsAdmin, callerCan, permissionKey, on }: CallerLimits & { permissionKey: string; on: boolean }): boolean {
  return on || callerIsAdmin || callerCan(permissionKey)
}

/**
 * The roles whose defaults are never edited in the matrix: Administrateur always has every
 * permission, and the professionals' permissions are managed by the Professionnels module.
 */
export const LOCKED_ROLES: ReadonlySet<string> = new Set(['admin', PROVIDER_ROLE])

/** Why a matrix cell is read-only for the caller, or null when she may toggle it. */
export type RoleCellLock = 'locked' | 'ownRole' | 'lacked'

/**
 * Whether the caller may toggle one role default (set_role_permission). Locked roles never; turning
 * a default off is otherwise always allowed; a non-admin manager turns one on only if she holds
 * that permission, and never in the role she has herself.
 */
export function roleCellLock({
  callerIsAdmin,
  callerCan,
  callerRole,
  role,
  permissionKey,
  on,
}: CallerLimits & { callerRole: string; role: string; permissionKey: string; on: boolean }): RoleCellLock | null {
  if (LOCKED_ROLES.has(role)) return 'locked'
  if (on || callerIsAdmin) return null
  if (role === callerRole) return 'ownRole'
  return callerCan(permissionKey) ? null : 'lacked'
}

/** A role name as the database stores it: trimmed, inner runs of whitespace as one space. */
export function normalizeRoleName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * Whether the caller may remove all of a user's overrides (clear_permission_overrides): a
 * non-admin manager is refused if any revoke is on a permission they lack (clearing it could give
 * the permission back).
 */
export function canResetOverrides({ callerIsAdmin, callerCan, overrides }: CallerLimits & { overrides: PermissionOverride[] }): boolean {
  return callerIsAdmin || overrides.every((o) => o.granted || callerCan(o.permission_key))
}

/**
 * Whether the caller holds every default of `role` (the hold rule of set_user_role and
 * create_role's copy): always for an admin; for a non-admin manager, each of its permissions.
 */
export function holdsRoleDefaults({ callerIsAdmin, callerCan, role, rolePermissions }: CallerLimits & { role: string; rolePermissions: RolePermission[] }): boolean {
  return callerIsAdmin || [...roleGrants(role, rolePermissions)].every((key) => callerCan(key))
}

/**
 * The roles the caller may assign, among `roles` (provider left out). Only an admin makes someone
 * admin; a non-admin manager may assign a role only if they hold every permission it gives by
 * default (set_user_role).
 */
export function assignableRoles({
  callerIsAdmin,
  callerCan,
  roles,
  rolePermissions,
}: CallerLimits & { roles: { key: string }[]; rolePermissions: RolePermission[] }): Set<string> {
  return new Set(
    roles
      .map((r) => r.key)
      .filter((role) => {
        if (role === PROVIDER_ROLE) return false
        if (callerIsAdmin) return true
        if (role === 'admin') return false
        return holdsRoleDefaults({ callerIsAdmin, callerCan, role, rolePermissions })
      }),
  )
}

/** The known roles in a fixed order (admin, counselor, admin_assistant, provider), then the others by name. */
export function orderRoles<T extends { key: string; name: string }>(roles: T[]): T[] {
  const rank = (key: string) => {
    const index = ROLE_ORDER.indexOf(key)
    return index === -1 ? ROLE_ORDER.length : index
  }
  return [...roles].sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name, 'fr-CA'))
}

export interface PermissionGroup<P> {
  key: string
  name: string
  permissions: P[]
}

/** View before manage: the `.view` keys first, then the others, each by key. */
const byViewThenKey = (a: { key: string }, b: { key: string }) =>
  Number(!a.key.endsWith('.view')) - Number(!b.key.endsWith('.view')) || a.key.localeCompare(b.key)

/**
 * Permissions grouped by module: core first, then the enabled modules by name; a disabled module's
 * permissions are left out (they grant nothing while it is off). Within a group, the `.view`
 * permissions come first, then the others, each by key.
 */
export function groupPermissionsByModule<P extends { key: string; module_key: string }>(
  permissions: P[],
  modules: { key: string; name: string }[],
  enabledModules: string[],
): PermissionGroup<P>[] {
  const enabled = modules
    .filter((m) => m.key !== 'core' && enabledModules.includes(m.key))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr-CA'))
  const core = modules.find((m) => m.key === 'core') ?? { key: 'core', name: 'core' }
  return [core, ...enabled]
    .map((m) => ({
      key: m.key,
      name: m.name,
      permissions: permissions.filter((p) => p.module_key === m.key).sort(byViewThenKey),
    }))
    .filter((g) => g.permissions.length > 0)
}
