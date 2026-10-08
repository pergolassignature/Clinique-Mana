import type { Access } from '@/core/access/access'
import { testAccess } from './contexts'

/**
 * Default permissions per role, mirroring the template public.role_permissions in the migrations
 * (20261007140517_core_access, 20261007140859_professionals_module, 20261007192359_core_roles_split,
 * 20261008015825_core_editable_roles), which every clinic starts from (org_role_permissions).
 * Update it with the migrations.
 */
export const ROLE_PERMISSIONS = {
  admin: [
    'settings.view',
    'settings.manage',
    'settings.bank_manage',
    'users.view',
    'users.manage',
    'modules.manage',
    'audit.view',
    'roles.manage',
    'professionals.view',
  ],
  admin_assistant: ['settings.view', 'professionals.view'],
  counselor: ['professionals.view'],
} as const satisfies Record<string, readonly string[]>

export type FixtureRole = keyof typeof ROLE_PERMISSIONS

/** An access payload with a role's real default permissions (no overrides). */
export function accessForRole(role: FixtureRole, overrides: Partial<Access> = {}): Access {
  return { ...testAccess, role, permissions: [...ROLE_PERMISSIONS[role]], ...overrides }
}
