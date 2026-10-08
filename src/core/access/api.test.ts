import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { fetchMyAccess, fetchOrgRoles } from './api'

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
