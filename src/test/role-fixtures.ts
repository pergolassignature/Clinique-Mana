import type { Access } from '@/core/access/access'
import { testAccess } from './contexts'

/**
 * Default permissions per role, mirroring the template public.role_permissions in the migrations
 * (20261007140517_core_access, 20261007140859_professionals_module, 20261007192359_core_roles_split,
 * 20261008015825_core_editable_roles, 20261008033613_core_shared_permissions,
 * 20261008082847_professionals_reference_data, 20261008191219_professionals_onboarding,
 * 20261009000253_professionals_documents), which
 * every clinic starts from (org_role_permissions). Update it with the migrations.
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
    'settings.email_manage',
    'settings.integrations_manage',
    'professionals.view',
    'professionals.manage',
    'professionals.matching',
    'professionals.activate_override',
    'professionals.settings',
    'professionals.compensation',
    'professionals.private',
    'professionals.self',
    'professionals.invite',
    'professionals.review',
    'professionals.documents.review',
    'professionals.documents.delete',
  ],
  admin_assistant: [
    'settings.view',
    'professionals.view',
    'professionals.manage',
    'professionals.matching',
    'professionals.invite',
    'professionals.review',
    'professionals.documents.review',
  ],
  counselor: ['professionals.view', 'professionals.matching'],
  provider: ['professionals.self'],
} as const satisfies Record<string, readonly string[]>

export type FixtureRole = keyof typeof ROLE_PERMISSIONS

/**
 * An access payload with a role's real default permissions (no overrides). A provider's account is
 * linked to a professional file (`has_professional_file`); staff accounts are not.
 */
export function accessForRole(role: FixtureRole, overrides: Partial<Access> = {}): Access {
  return { ...testAccess, role, permissions: [...ROLE_PERMISSIONS[role]], has_professional_file: role === 'provider', ...overrides }
}
