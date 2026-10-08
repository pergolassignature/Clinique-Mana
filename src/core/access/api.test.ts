import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { fetchMyAccess, fetchOrgRoles, fetchPermissionCatalog } from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), captureException: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: (table: string) => ({ select: (columns: string) => mocks.select(table, columns) }) } }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => {
  mocks.rpc.mockReset()
  mocks.select.mockReset()
  mocks.captureException.mockReset()
})

describe('fetchMyAccess', () => {
  it('reports an unexpected payload to Sentry and rethrows it', async () => {
    mocks.rpc.mockResolvedValue({ data: { hello: 'world' }, error: null })
    await expect(fetchMyAccess()).rejects.toBeInstanceOf(ZodError)
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(ZodError), expect.anything())
  })

  it('throws RPC errors without reporting them as payload bugs', async () => {
    const error = { message: 'network', code: '' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchMyAccess()).rejects.toBe(error)
    expect(mocks.captureException).not.toHaveBeenCalled()
  })
})

describe('fetchOrgRoles', () => {
  it("reads the base roles and the clinic's custom roles (RLS), with their org", async () => {
    const roles = [
      { key: 'admin', name: 'Administrateur', org_id: null },
      { key: 'custom_0a1b2c3d', name: 'Réception', org_id: 'o1' },
    ]
    mocks.select.mockResolvedValue({ data: roles, error: null })
    await expect(fetchOrgRoles()).resolves.toEqual(roles)
    expect(mocks.select).toHaveBeenCalledWith('roles', 'key, name, org_id')
  })

  it('throws the query error', async () => {
    const error = { code: 'PGRST301', message: 'JWT expired' }
    mocks.select.mockResolvedValue({ data: null, error })
    await expect(fetchOrgRoles()).rejects.toBe(error)
  })
})

describe('fetchPermissionCatalog', () => {
  const tables = (results: Record<string, { data: unknown; error: unknown }>) =>
    mocks.select.mockImplementation((table: string) => Promise.resolve(results[table]))

  it('reads the permissions and modules (the template; the role defaults are per clinic)', async () => {
    tables({
      permissions: { data: [{ key: 'audit.view', module_key: 'core', description: "Consulter le journal d'audit" }], error: null },
      modules: { data: [{ key: 'core', name: 'Noyau' }], error: null },
    })
    await expect(fetchPermissionCatalog()).resolves.toEqual({
      permissions: [{ key: 'audit.view', module_key: 'core', description: "Consulter le journal d'audit" }],
      modules: [{ key: 'core', name: 'Noyau' }],
    })
    expect(mocks.select.mock.calls).toEqual([
      ['permissions', 'key, module_key, description'],
      ['modules', 'key, name'],
    ])
  })

  it('throws the first error', async () => {
    const error = { code: 'PGRST301', message: 'JWT expired' }
    tables({ permissions: { data: [], error: null }, modules: { data: null, error } })
    await expect(fetchPermissionCatalog()).rejects.toBe(error)
  })
})
