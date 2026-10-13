import type { Access } from '@/core/access/access'
import { testAccess } from './contexts'

/**
 * Default permissions per role, mirroring the template public.role_permissions in the migrations
 * (20261007140517_core_access, 20261007140859_professionals_module, 20261007192359_core_roles_split,
 * 20261008015825_core_editable_roles, 20261008033613_core_shared_permissions,
 * 20261008133511_professionals_reference_data, 20261008191219_professionals_onboarding,
 * 20261009000253_professionals_documents, 20261009030158_professionals_contracts, 20261012184103_services_module, 20261012184051_communications_module, 20261012203302_communications_sms, 20261012213428_clients_module,
 * 20261012223803_demandes_module, 20261013055753_appointments_module, 20261013105817_billing_module, 20261013111236_billing_quickbooks, 20261013160540_reports_module), which
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
    'professionals.contracts.send',
    'services.view',
    'services.manage',
    'communications.inbox',
    'communications.mailboxes_manage',
    'communications.sms',
    'communications.sms_manage',
    'clients.view',
    'clients.manage',
    'clients.merge',
    'clients.privacy',
    'clients.self',
    'demandes.view',
    'demandes.manage',
    'demandes.notes',
    'demandes.waitlist',
    'demandes.self',
    'appointments.view',
    'appointments.manage',
    'appointments.self',
    'appointments.balance_override',
    'appointments.settings',
    'billing.view',
    'billing.manage',
    'billing.self',
    'billing.settings',
    'reports.view',
    'reports.finance',
  ],
  admin_assistant: [
    'settings.view',
    'professionals.view',
    'professionals.manage',
    'professionals.matching',
    'professionals.invite',
    'professionals.review',
    'professionals.documents.review',
    'services.view',
    'services.manage',
    'clients.view',
    'clients.manage',
    'clients.merge',
    'demandes.view',
    'demandes.manage',
    'demandes.notes',
    'demandes.waitlist',
    'appointments.view',
    'appointments.manage',
    'appointments.balance_override',
    'billing.view',
    'billing.manage',
    'reports.finance',
  ],
  counselor: [
    'professionals.view',
    'professionals.matching',
    'services.view',
    'clients.view',
    'clients.manage',
    'demandes.view',
    'demandes.manage',
    'demandes.notes',
    'demandes.waitlist',
    'appointments.view',
    'appointments.manage',
    'billing.view',
  ],
  provider: ['professionals.self', 'services.view', 'clients.self', 'demandes.self', 'appointments.self', 'billing.self'],
} as const satisfies Record<string, readonly string[]>

export type FixtureRole = keyof typeof ROLE_PERMISSIONS

/**
 * An access payload with a role's real default permissions (no overrides). A provider's account is
 * linked to a professional file (`has_professional_file`); staff accounts are not.
 */
export function accessForRole(role: FixtureRole, overrides: Partial<Access> = {}): Access {
  return { ...testAccess, role, permissions: [...ROLE_PERMISSIONS[role]], has_professional_file: role === 'provider', ...overrides }
}
