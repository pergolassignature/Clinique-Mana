import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPermissionOverride,
  fetchOrgUsers,
  fetchPermissionCatalog,
  fetchUserOverrides,
  setPermissionOverride,
  setUserRole,
  setUserStatus,
} from './api'

const mocks = vi.hoisted(() => {
  const rpc = vi.fn()
  // from(table).select(columns) resolves per table; .eq() narrows the overrides query.
  const results = new Map<string, unknown>()
  const eq = vi.fn()
  const select = vi.fn()
  const from = vi.fn((table: string) => ({
    select: (columns: string) => {
      select(table, columns)
      const result = Promise.resolve(results.get(table))
      return Object.assign(result, {
        eq: (column: string, value: string) => {
          eq(table, column, value)
          return Promise.resolve(results.get(table))
        },
      })
    },
  }))
  return { rpc, from, select, eq, results }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

afterEach(() => {
  vi.clearAllMocks()
  mocks.results.clear()
})

const failure = { code: 'P0001', message: 'La clinique doit garder au moins un administrateur actif.' }

describe('fetchOrgUsers', () => {
  it('lists the org users through list_org_users, keeping the nullable columns null', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          user_id: 'u2',
          display_name: 'Conseillère Locale',
          email: 'conseillere@mana.test',
          status: 'active',
          role: 'counselor',
          role_name: 'Conseillère',
          last_sign_in_at: '2026-10-07T14:30:00+00:00',
          override_count: 1,
        },
        {
          user_id: 'u3',
          display_name: 'Sans Rôle',
          email: 'sans@mana.test',
          status: 'disabled',
          role: null,
          role_name: null,
          last_sign_in_at: null,
          override_count: 0,
        },
      ],
      error: null,
    })
    const users = await fetchOrgUsers()
    expect(mocks.rpc).toHaveBeenCalledWith('list_org_users')
    expect(users).toEqual([
      {
        user_id: 'u2',
        display_name: 'Conseillère Locale',
        email: 'conseillere@mana.test',
        status: 'active',
        role: 'counselor',
        role_name: 'Conseillère',
        last_sign_in_at: '2026-10-07T14:30:00+00:00',
        override_count: 1,
      },
      {
        user_id: 'u3',
        display_name: 'Sans Rôle',
        email: 'sans@mana.test',
        status: 'disabled',
        role: null,
        role_name: null,
        last_sign_in_at: null,
        override_count: 0,
      },
    ])
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée : users.view' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchOrgUsers()).rejects.toBe(error)
  })
})

describe('fetchPermissionCatalog', () => {
  it('reads permissions, role defaults, roles and modules', async () => {
    mocks.results.set('permissions', { data: [{ key: 'audit.view', module_key: 'core', description: "Consulter le journal d'audit" }], error: null })
    mocks.results.set('role_permissions', { data: [{ role: 'admin', permission_key: 'audit.view' }], error: null })
    mocks.results.set('roles', { data: [{ key: 'admin', name: 'Administrateur' }], error: null })
    mocks.results.set('modules', { data: [{ key: 'core', name: 'Noyau' }], error: null })
    await expect(fetchPermissionCatalog()).resolves.toEqual({
      permissions: [{ key: 'audit.view', module_key: 'core', description: "Consulter le journal d'audit" }],
      rolePermissions: [{ role: 'admin', permission_key: 'audit.view' }],
      roles: [{ key: 'admin', name: 'Administrateur' }],
      modules: [{ key: 'core', name: 'Noyau' }],
    })
    expect(mocks.select.mock.calls).toEqual(
      expect.arrayContaining([
        ['permissions', 'key, module_key, description'],
        ['role_permissions', 'role, permission_key'],
        ['roles', 'key, name'],
        ['modules', 'key, name'],
      ]),
    )
  })

  it('throws the first error', async () => {
    const error = { code: 'PGRST301', message: 'JWT expired' }
    mocks.results.set('permissions', { data: [], error: null })
    mocks.results.set('role_permissions', { data: null, error })
    mocks.results.set('roles', { data: [], error: null })
    mocks.results.set('modules', { data: [], error: null })
    await expect(fetchPermissionCatalog()).rejects.toBe(error)
  })
})

describe('fetchUserOverrides', () => {
  it("reads the user's overrides", async () => {
    mocks.results.set('user_permission_overrides', { data: [{ permission_key: 'audit.view', granted: true }], error: null })
    await expect(fetchUserOverrides('u2')).resolves.toEqual([{ permission_key: 'audit.view', granted: true }])
    expect(mocks.select).toHaveBeenCalledWith('user_permission_overrides', 'permission_key, granted')
    expect(mocks.eq).toHaveBeenCalledWith('user_permission_overrides', 'user_id', 'u2')
  })

  it('throws the query error', async () => {
    const error = { code: '42501', message: 'denied' }
    mocks.results.set('user_permission_overrides', { data: null, error })
    await expect(fetchUserOverrides('u2')).rejects.toBe(error)
  })
})

describe('write RPCs', () => {
  it.each([
    ['setUserRole', () => setUserRole('u2', 'admin_assistant'), 'set_user_role', { p_user_id: 'u2', p_role: 'admin_assistant' }],
    ['setUserStatus', () => setUserStatus('u2', 'disabled'), 'set_user_status', { p_user_id: 'u2', p_status: 'disabled' }],
    [
      'setPermissionOverride',
      () => setPermissionOverride('u2', 'audit.view', true),
      'set_permission_override',
      { p_user_id: 'u2', p_permission_key: 'audit.view', p_granted: true },
    ],
    [
      'clearPermissionOverride',
      () => clearPermissionOverride('u2', 'audit.view'),
      'clear_permission_override',
      { p_user_id: 'u2', p_permission_key: 'audit.view' },
    ],
  ])('%s calls its RPC and throws its error', async (_name, call, rpc, args) => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(call()).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, args)

    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(call()).rejects.toBe(failure)
  })
})
