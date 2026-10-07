import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModules, setModuleEnabled } from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => mocks.rpc.mockReset())

describe('fetchModules', () => {
  it('maps list_modules rows to ModuleRow', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ key: 'professionals', name: 'Professionnels', depends_on: [], enabled: true, extra: 'ignored' }],
      error: null,
    })
    await expect(fetchModules()).resolves.toEqual([
      { key: 'professionals', name: 'Professionnels', depends_on: [], enabled: true },
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('list_modules')
  })

  it('throws RPC errors', async () => {
    const error = { message: 'boom', code: '' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchModules()).rejects.toBe(error)
  })
})

describe('setModuleEnabled', () => {
  it('calls set_module_enabled with the key and flag', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await setModuleEnabled('professionals', false)
    expect(mocks.rpc).toHaveBeenCalledWith('set_module_enabled', { p_key: 'professionals', p_enabled: false })
  })

  it('throws the RPC error (French message from SQL)', async () => {
    const error = { message: "Activez d'abord : Professionnels", code: 'P0001' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(setModuleEnabled('x', true)).rejects.toBe(error)
  })
})
