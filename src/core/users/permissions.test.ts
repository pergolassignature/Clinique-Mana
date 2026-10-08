import { describe, expect, it } from 'vitest'
import {
  assignableRoles,
  canResetOverrides,
  canTogglePermission,
  effectivePermission,
  groupPermissionsByModule,
  holdsRoleDefaults,
  isCustomRole,
  confirmsSelfRemoval,
  foldRoleName,
  normalizeRoleName,
  orderRoles,
  roleCellLock,
  overrideStateOf,
  roleGrants,
  stateForSwitch,
} from './permissions'

const ROLE_PERMISSIONS = [
  { role: 'admin', permission_key: 'settings.view' },
  { role: 'admin', permission_key: 'settings.manage' },
  { role: 'admin', permission_key: 'audit.view' },
  { role: 'admin', permission_key: 'professionals.view' },
  { role: 'admin_assistant', permission_key: 'settings.view' },
  { role: 'admin_assistant', permission_key: 'professionals.view' },
  { role: 'counselor', permission_key: 'professionals.view' },
  { role: 'custom_0a1b2c3d', permission_key: 'settings.view' },
]
const ROLES = [
  { key: 'admin', name: 'Administrateur', org_id: null },
  { key: 'counselor', name: 'Conseillère', org_id: null },
  { key: 'admin_assistant', name: 'Adjointe administrative', org_id: null },
  { key: 'provider', name: 'Professionnel', org_id: null },
  { key: 'custom_0a1b2c3d', name: 'Réception', org_id: 'o1' },
]

describe('roleGrants', () => {
  it("gives the role's defaults only", () => {
    expect(roleGrants('admin_assistant', ROLE_PERMISSIONS)).toEqual(new Set(['settings.view', 'professionals.view']))
    expect(roleGrants('counselor', ROLE_PERMISSIONS)).toEqual(new Set(['professionals.view']))
  })

  it('is empty for a role without defaults or no role', () => {
    expect(roleGrants('provider', ROLE_PERMISSIONS)).toEqual(new Set())
    expect(roleGrants(null, ROLE_PERMISSIONS)).toEqual(new Set())
  })
})

describe('overrideStateOf', () => {
  const overrides = [
    { permission_key: 'audit.view', granted: true },
    { permission_key: 'professionals.view', granted: false },
  ]
  it('reads granted, revoked, or role when there is no override', () => {
    expect(overrideStateOf('audit.view', overrides)).toBe('granted')
    expect(overrideStateOf('professionals.view', overrides)).toBe('revoked')
    expect(overrideStateOf('settings.view', overrides)).toBe('role')
  })
})

describe('effectivePermission', () => {
  const overrides = [
    { permission_key: 'audit.view', granted: true },
    { permission_key: 'professionals.view', granted: false },
  ]
  it('is the role default without an override', () => {
    expect(effectivePermission('settings.view', true, overrides)).toEqual({ on: true, override: null })
    expect(effectivePermission('settings.view', false, overrides)).toEqual({ on: false, override: null })
  })
  it("is the override's value when there is one, whatever the role gives", () => {
    expect(effectivePermission('audit.view', false, overrides)).toEqual({ on: true, override: true })
    expect(effectivePermission('professionals.view', true, overrides)).toEqual({ on: false, override: false })
  })
})

describe('stateForSwitch', () => {
  it('back to the role value clears the override', () => {
    expect(stateForSwitch(true, true)).toBe('role')
    expect(stateForSwitch(false, false)).toBe('role')
  })
  it('away from the role value grants or revokes', () => {
    expect(stateForSwitch(false, true)).toBe('granted')
    expect(stateForSwitch(true, false)).toBe('revoked')
  })
})

describe('canTogglePermission', () => {
  const holds = (keys: string[]) => (key: string) => keys.includes(key)

  it('an admin may always toggle', () => {
    expect(canTogglePermission({ callerIsAdmin: true, callerCan: holds([]), permissionKey: 'audit.view', on: false })).toBe(true)
  })
  it('a manager holding the permission may turn it on or off', () => {
    expect(canTogglePermission({ callerIsAdmin: false, callerCan: holds(['audit.view']), permissionKey: 'audit.view', on: false })).toBe(true)
    expect(canTogglePermission({ callerIsAdmin: false, callerCan: holds(['audit.view']), permissionKey: 'audit.view', on: true })).toBe(true)
  })
  it('a manager lacking it may turn it off, never on (a grant, or a cleared revoke)', () => {
    expect(canTogglePermission({ callerIsAdmin: false, callerCan: holds([]), permissionKey: 'audit.view', on: true })).toBe(true)
    expect(canTogglePermission({ callerIsAdmin: false, callerCan: holds([]), permissionKey: 'audit.view', on: false })).toBe(false)
  })
})

describe('roleCellLock', () => {
  const holds = (keys: string[]) => (key: string) => keys.includes(key)
  const admin = { callerIsAdmin: true, callerCan: holds([]), callerRole: 'admin' }
  const manager = { callerIsAdmin: false, callerCan: holds(['audit.view']), callerRole: 'admin_assistant' }

  it('locks the admin and provider columns for everyone', () => {
    for (const role of ['admin', 'provider']) {
      expect(roleCellLock({ ...admin, role, permissionKey: 'audit.view', on: false })).toBe('locked')
      expect(roleCellLock({ ...admin, role, permissionKey: 'audit.view', on: true })).toBe('locked')
    }
  })

  it('lets an admin toggle any other cell', () => {
    expect(roleCellLock({ ...admin, role: 'counselor', permissionKey: 'users.manage', on: false })).toBeNull()
  })

  it('lets a manager turn any cell off, and on only for a permission she holds', () => {
    expect(roleCellLock({ ...manager, role: 'counselor', permissionKey: 'users.manage', on: true })).toBeNull()
    expect(roleCellLock({ ...manager, role: 'counselor', permissionKey: 'audit.view', on: false })).toBeNull()
    expect(roleCellLock({ ...manager, role: 'counselor', permissionKey: 'users.manage', on: false })).toBe('lacked')
  })

  it('never lets a manager add to her own role; removing stays allowed', () => {
    expect(roleCellLock({ ...manager, role: 'admin_assistant', permissionKey: 'audit.view', on: false })).toBe('ownRole')
    expect(roleCellLock({ ...manager, role: 'admin_assistant', permissionKey: 'audit.view', on: true })).toBeNull()
  })
})

describe('normalizeRoleName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeRoleName('  Accueil \t  du   soir \n')).toBe('Accueil du soir')
  })

  it('uses the database\'s whitespace (Unicode White_Space), not JavaScript\'s \\s', () => {
    expect(normalizeRoleName('\u00A0Accueil\u3000du\u2003soir\u0085')).toBe('Accueil du soir')
    // U+FEFF is not whitespace for the database (it refuses it as invisible): kept, so it is refused there.
    expect(normalizeRoleName('Accueil\uFEFF')).toBe('Accueil\uFEFF')
  })
})

describe('foldRoleName', () => {
  it('compares like the unique index: normalized, NFKC, case folded', () => {
    expect(foldRoleName(' RÉCEPTION ')).toBe(foldRoleName('réception'))
    expect(foldRoleName('\uFF21dministrateur')).toBe('administrateur')
    expect(foldRoleName('conseille\u0300re')).toBe(foldRoleName('Conseillère'))
  })
})

describe('canResetOverrides', () => {
  const holds = (keys: string[]) => (key: string) => keys.includes(key)
  const overrides = [
    { permission_key: 'settings.manage', granted: true },
    { permission_key: 'professionals.view', granted: false },
  ]
  it('an admin may always reset', () => {
    expect(canResetOverrides({ callerIsAdmin: true, callerCan: holds([]), overrides })).toBe(true)
  })
  it('a manager may reset unless a revoke is on a permission they lack; grants do not matter', () => {
    expect(canResetOverrides({ callerIsAdmin: false, callerCan: holds(['professionals.view']), overrides })).toBe(true)
    expect(canResetOverrides({ callerIsAdmin: false, callerCan: holds([]), overrides })).toBe(false)
  })
})

describe('isCustomRole', () => {
  it("is true for a clinic's own role only", () => {
    expect(isCustomRole({ org_id: 'o1' })).toBe(true)
    expect(isCustomRole({ org_id: null })).toBe(false)
  })
})

describe('holdsRoleDefaults', () => {
  const holds = (keys: string[]) => (key: string) => keys.includes(key)

  it('an admin holds every role', () => {
    expect(holdsRoleDefaults({ callerIsAdmin: true, callerCan: holds([]), role: 'admin', rolePermissions: ROLE_PERMISSIONS })).toBe(true)
  })

  it('a manager holds a role when she has each of its defaults (an empty role included)', () => {
    const manager = { callerIsAdmin: false, callerCan: holds(['settings.view', 'professionals.view']), rolePermissions: ROLE_PERMISSIONS }
    expect(holdsRoleDefaults({ ...manager, role: 'admin_assistant' })).toBe(true)
    expect(holdsRoleDefaults({ ...manager, role: 'provider' })).toBe(true)
    expect(holdsRoleDefaults({ ...manager, role: 'admin' })).toBe(false)
  })
})

describe('assignableRoles', () => {
  const holds = (keys: string[]) => (key: string) => keys.includes(key)

  it('an admin may assign every base role but provider, and the custom roles', () => {
    expect(assignableRoles({ callerIsAdmin: true, callerCan: holds([]), roles: ROLES, rolePermissions: ROLE_PERMISSIONS })).toEqual(
      new Set(['admin', 'counselor', 'admin_assistant', 'custom_0a1b2c3d']),
    )
  })

  it('a manager may assign only the non-admin roles whose defaults they hold', () => {
    expect(
      assignableRoles({ callerIsAdmin: false, callerCan: holds(['professionals.view']), roles: ROLES, rolePermissions: ROLE_PERMISSIONS }),
    ).toEqual(new Set(['counselor']))
    expect(
      assignableRoles({
        callerIsAdmin: false,
        callerCan: holds(['professionals.view', 'settings.view', 'settings.manage', 'audit.view']),
        roles: ROLES,
        rolePermissions: ROLE_PERMISSIONS,
      }),
    ).toEqual(new Set(['counselor', 'admin_assistant', 'custom_0a1b2c3d']))
  })
})

describe('orderRoles', () => {
  it('lists the known roles first in a fixed order, then the others by name', () => {
    const roles = [
      { key: 'provider', name: 'Professionnel' },
      { key: 'zeta', name: 'Zêta' },
      { key: 'counselor', name: 'Conseillère' },
      { key: 'admin', name: 'Administrateur' },
      { key: 'alpha', name: 'Éducatrice' },
      { key: 'admin_assistant', name: 'Adjointe administrative' },
    ]
    expect(orderRoles(roles).map((r) => r.key)).toEqual(['admin', 'counselor', 'admin_assistant', 'provider', 'alpha', 'zeta'])
  })
})

describe('groupPermissionsByModule', () => {
  const permissions = [
    { key: 'users.view', module_key: 'core', description: 'Voir les utilisateurs' },
    { key: 'users.manage', module_key: 'core', description: 'Gérer les utilisateurs' },
    { key: 'modules.manage', module_key: 'core', description: 'Gérer les modules' },
    { key: 'billing.view', module_key: 'billing', description: 'Voir la facturation' },
    { key: 'audit.view', module_key: 'core', description: "Consulter le journal d'audit" },
    { key: 'professionals.view', module_key: 'professionals', description: 'Voir les professionnels' },
    { key: 'agenda.view', module_key: 'agenda', description: "Voir l'agenda" },
  ]
  const modules = [
    { key: 'core', name: 'Noyau' },
    { key: 'professionals', name: 'Professionnels' },
    { key: 'billing', name: 'Facturation' },
    { key: 'agenda', name: 'Agenda' },
  ]

  it('puts core first, then the enabled modules by name; view before manage; disabled modules left out', () => {
    const groups = groupPermissionsByModule(permissions, modules, ['professionals', 'agenda'])
    expect(groups.map((g) => [g.key, g.name, g.permissions.map((p) => p.key)])).toEqual([
      ['core', 'Noyau', ['audit.view', 'users.view', 'modules.manage', 'users.manage']],
      ['agenda', 'Agenda', ['agenda.view']],
      ['professionals', 'Professionnels', ['professionals.view']],
    ])
  })

  it('leaves out an enabled module without permissions', () => {
    expect(groupPermissionsByModule(permissions.filter((p) => p.module_key === 'core'), modules, ['agenda']).map((g) => g.key)).toEqual(['core'])
  })
})

describe('confirmsSelfRemoval', () => {
  const own = { callerRole: 'admin_assistant', role: 'admin_assistant' }
  it('asks before removing roles.manage or users.manage from the caller\'s own role', () => {
    expect(confirmsSelfRemoval({ ...own, permissionKey: 'roles.manage', next: false })).toBe(true)
    expect(confirmsSelfRemoval({ ...own, permissionKey: 'users.manage', next: false })).toBe(true)
  })

  it('does not ask for another permission, another role, or a grant', () => {
    expect(confirmsSelfRemoval({ ...own, permissionKey: 'users.view', next: false })).toBe(false)
    expect(confirmsSelfRemoval({ ...own, role: 'counselor', permissionKey: 'roles.manage', next: false })).toBe(false)
    expect(confirmsSelfRemoval({ ...own, permissionKey: 'roles.manage', next: true })).toBe(false)
  })
})
