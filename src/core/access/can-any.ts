/**
 * Whether the user holds the permission, or any one of the permissions (none: false). One check for
 * every place a permission may be several keys: settings sections, menu entries, routes
 * (`RequireAccess`).
 */
export function canAny(permission: string | readonly string[], can: (permission: string) => boolean): boolean {
  return typeof permission === 'string' ? can(permission) : permission.some((p) => can(p))
}
