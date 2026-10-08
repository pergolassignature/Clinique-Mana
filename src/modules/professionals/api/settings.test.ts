import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProfessionalsSettings, saveProfessionalsSettings } from './settings'
import { UNEXPECTED_SHAPE } from './parse'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

describe('fetchProfessionalsSettings', () => {
  it('reads the effective settings (defaults merged in SQL)', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: false }, error: null })
    await expect(fetchProfessionalsSettings()).resolves.toEqual({ collectSin: false })
    expect(mocks.rpc).toHaveBeenCalledWith('get_professionals_settings')
  })

  it('throws the shape error on an unexpected value', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: 'yes' }, error: null })
    await expect(fetchProfessionalsSettings()).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('saveProfessionalsSettings', () => {
  it('sends only the changed keys, in SQL names, and returns the effective settings', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: true }, error: null })
    await expect(saveProfessionalsSettings({ collectSin: true })).resolves.toEqual({ collectSin: true })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professionals_settings', { p_patch: { collect_sin: true } })
  })

  it('throws the refusal unchanged (collect_sin needs professionals.private)', async () => {
    const error = { code: '42501', message: 'Permission refusée : professionals.private' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(saveProfessionalsSettings({ collectSin: true })).rejects.toBe(error)
  })
})
