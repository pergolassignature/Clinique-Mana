/**
 * Permission helpers for « Utilisateurs et accès ». They mirror the database
 * (`private.has_permission` and the guards of `20261007211509_core_user_admin.sql`) so the UI
 * hides what the server would refuse; the server still decides, and its message is shown if it does.
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

/** The roles managed here; `provider` is owned by the Professionnels module (decision #28). */
export const MANAGED_ROLES = ['admin', 'counselor', 'admin_assistant'] as const

/** Menu and matrix order of the known roles; roles added later follow, by name. */
const ROLE_ORDER = ['admin', 'counselor', 'admin_assistant', 'provider']

/** What the role gives by default. */
export function roleGrants(role: string | null, rolePermissions: RolePermission[]): Set<string> {
  return new Set(rolePermissions.filter((rp) => rp.role === role).map((rp) => rp.permission_key))
}

/** Effective = (role defaults ∪ granted) − revoked. Mirrors private.has_permission (module gate excluded). */
export function effectivePermissions(roleSet: Set<string>, overrides: PermissionOverride[]): Set<string> {
  const effective = new Set(roleSet)
  for (const o of overrides) if (o.granted) effective.add(o.permission_key)
  for (const o of overrides) if (!o.granted) effective.delete(o.permission_key)
  return effective
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

/**
 * The states the caller may choose for one permission of another user. A non-admin manager never
 * gives what they lack: no grant, and no cleared revoke (the role default could give it back);
 * revoking, or clearing a grant, is always allowed.
 */
export function allowedOverrideStates({
  callerIsAdmin,
  callerCan,
  permissionKey,
  current,
}: CallerLimits & { permissionKey: string; current: OverrideState }): Set<OverrideState> {
  const holds = callerIsAdmin || callerCan(permissionKey)
  const allowed = new Set<OverrideState>(['revoked'])
  if (holds) allowed.add('granted')
  if (holds || current !== 'revoked') allowed.add('role')
  return allowed
}

/**
 * The roles the caller may assign. Only an admin makes someone admin; a non-admin manager may
 * assign a role only if they hold every permission it gives by default (set_user_role).
 */
export function assignableRoles({ callerIsAdmin, callerCan, rolePermissions }: CallerLimits & { rolePermissions: RolePermission[] }): Set<string> {
  return new Set(
    MANAGED_ROLES.filter((role) => {
      if (callerIsAdmin) return true
      if (role === 'admin') return false
      return [...roleGrants(role, rolePermissions)].every((key) => callerCan(key))
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

/**
 * Permissions grouped by module: core first, then the enabled modules by name; a disabled module's
 * permissions are left out (they grant nothing while it is off). Permissions sorted by key.
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
      permissions: permissions.filter((p) => p.module_key === m.key).sort((a, b) => a.key.localeCompare(b.key)),
    }))
    .filter((g) => g.permissions.length > 0)
}
