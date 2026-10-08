import type { OrgRole } from '@/core/access/api'
import type { OrgUser, PermissionCatalog } from '@/core/users/api'
import type { RolePermission } from '@/core/users/permissions'
import { ROLE_PERMISSIONS } from './role-fixtures'

/**
 * The permission catalogue as seeded (descriptions from the migrations), plus a `billing`
 * permission whose module the test access leaves disabled.
 */
export const testCatalog: PermissionCatalog = {
  permissions: [
    { key: 'audit.view', module_key: 'core', description: "Consulter le journal d'audit" },
    { key: 'modules.manage', module_key: 'core', description: 'Activer ou désactiver des modules' },
    { key: 'settings.bank_manage', module_key: 'core', description: 'Voir et modifier les coordonnées bancaires de la clinique' },
    { key: 'settings.manage', module_key: 'core', description: 'Modifier les paramètres de la clinique' },
    { key: 'settings.view', module_key: 'core', description: 'Voir les paramètres' },
    { key: 'users.manage', module_key: 'core', description: 'Inviter et gérer les utilisateurs' },
    { key: 'users.view', module_key: 'core', description: 'Voir les utilisateurs' },
    { key: 'roles.manage', module_key: 'core', description: 'Gérer les rôles' },
    { key: 'settings.email_manage', module_key: 'core', description: 'Gérer les courriels de la clinique' },
    { key: 'settings.integrations_manage', module_key: 'core', description: "Gérer les clés d'intégration" },
    { key: 'professionals.view', module_key: 'professionals', description: 'Voir les professionnels' },
    { key: 'billing.view', module_key: 'billing', description: 'Voir la facturation' },
  ],
  modules: [
    { key: 'core', name: 'Noyau' },
    { key: 'professionals', name: 'Professionnels' },
    { key: 'billing', name: 'Facturation' },
  ],
}

/** The base roles, in the database's order (the UI orders them). */
export const testRoles: OrgRole[] = [
  { key: 'provider', name: 'Professionnel', org_id: null },
  { key: 'counselor', name: 'Conseillère', org_id: null },
  { key: 'admin_assistant', name: 'Adjointe administrative', org_id: null },
  { key: 'admin', name: 'Administrateur', org_id: null },
]

/** A custom role of the test clinic (`o1`), with no defaults unless a test gives it some. */
export const customRole: OrgRole = { key: 'custom_0a1b2c3d', name: 'Réception', org_id: 'o1' }

/** The clinic's role defaults as seeded from the template (admin also holds `billing.view`). */
export const testRoleDefaults: RolePermission[] = [
  ...Object.entries(ROLE_PERMISSIONS).flatMap(([role, keys]) => keys.map((permission_key) => ({ role, permission_key }))),
  { role: 'admin', permission_key: 'billing.view' },
]

/** The seeded users (supabase/seed.sql), `u-admin` being the test access's user. */
export const testUsers: OrgUser[] = [
  {
    user_id: 'u-admin',
    display_name: 'Admin Local',
    email: 'admin@mana.test',
    status: 'active',
    role: 'admin',
    role_name: 'Administrateur',
    last_sign_in_at: '2026-10-07T18:30:00+00:00',
    override_count: 0,
  },
  {
    user_id: 'u-adjointe',
    display_name: 'Adjointe Locale',
    email: 'adjointe@mana.test',
    status: 'active',
    role: 'admin_assistant',
    role_name: 'Adjointe administrative',
    last_sign_in_at: null,
    override_count: 0,
  },
  {
    user_id: 'u-conseillere',
    display_name: 'Conseillère Locale',
    email: 'conseillere@mana.test',
    status: 'active',
    role: 'counselor',
    role_name: 'Conseillère',
    last_sign_in_at: '2026-10-06T13:05:00+00:00',
    override_count: 1,
  },
  {
    user_id: 'u-pro',
    display_name: 'Pro Local',
    email: 'provider@mana.test',
    status: 'disabled',
    role: 'provider',
    role_name: 'Professionnel',
    last_sign_in_at: null,
    override_count: 0,
  },
]
