import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPermissionOverride,
  clearPermissionOverrides,
  createRole,
  deleteRole,
  fetchOrgUsers,
  fetchRoleDefaults,
  fetchUserOverrides,
  renameRole,
  setPermissionOverride,
  setRolePermission,
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

describe('fetchRoleDefaults', () => {
  it("reads the clinic's role defaults (org_role_permissions), never the template", async () => {
    mocks.results.set('org_role_permissions', { data: [{ role: 'counselor', permission_key: 'professionals.view' }], error: null })
    await expect(fetchRoleDefaults('o1')).resolves.toEqual([{ role: 'counselor', permission_key: 'professionals.view' }])
    expect(mocks.select).toHaveBeenCalledWith('org_role_permissions', 'role, permission_key')
    expect(mocks.eq).toHaveBeenCalledWith('org_role_permissions', 'org_id', 'o1')
    expect(mocks.from).not.toHaveBeenCalledWith('role_permissions')
  })

  it('throws the query error', async () => {
    const error = { code: '42501', message: 'denied' }
    mocks.results.set('org_role_permissions', { data: null, error })
    await expect(fetchRoleDefaults('o1')).rejects.toBe(error)
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
    [
      'setRolePermission',
      () => setRolePermission('counselor', 'audit.view', false),
      'set_role_permission',
      { p_role: 'counselor', p_permission_key: 'audit.view', p_granted: false },
    ],
    ['renameRole', () => renameRole('custom_0a1b2c3d', 'Accueil'), 'rename_role', { p_role: 'custom_0a1b2c3d', p_name: 'Accueil' }],
    ['deleteRole', () => deleteRole('custom_0a1b2c3d'), 'delete_role', { p_role: 'custom_0a1b2c3d' }],
  ])('%s calls its RPC and throws its error', async (_name, call, rpc, args) => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(call()).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, args)

    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(call()).rejects.toBe(failure)
  })

  it('clearPermissionOverrides calls its RPC, returns the number removed and throws its error', async () => {
    mocks.rpc.mockResolvedValue({ data: 3, error: null })
    await expect(clearPermissionOverrides('u2')).resolves.toBe(3)
    expect(mocks.rpc).toHaveBeenCalledWith('clear_permission_overrides', { p_user_id: 'u2' })

    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(clearPermissionOverrides('u2')).rejects.toBe(failure)
  })

  it('createRole sends the name, and the role to copy only when there is one; returns the new key', async () => {
    mocks.rpc.mockResolvedValue({ data: 'custom_0a1b2c3d', error: null })
    await expect(createRole('Réception', null)).resolves.toBe('custom_0a1b2c3d')
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_role', { p_name: 'Réception' })
    await createRole('Réception', 'admin_assistant')
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_role', { p_name: 'Réception', p_copy_from: 'admin_assistant' })

    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(createRole('Réception', null)).rejects.toBe(failure)
  })
})
