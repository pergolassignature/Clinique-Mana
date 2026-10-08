import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteUserPreference, fetchUserPreference, saveUserPreference } from './api'

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const eq = vi.fn()
  const chain = { eq, maybeSingle }
  eq.mockReturnValue(chain)
  const select = vi.fn(() => chain)
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn()
  return { from, select, eq, maybeSingle, rpc }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

describe('fetchUserPreference', () => {
  it('reads the user’s row by its primary key', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { value: { query: 'statut=actif' } }, error: null })
    await expect(fetchUserPreference('u1', 'professionals.list_filters')).resolves.toEqual({ query: 'statut=actif' })
    expect(mocks.from).toHaveBeenCalledWith('user_preferences')
    expect(mocks.select).toHaveBeenCalledWith('value')
    expect(mocks.eq.mock.calls).toEqual([
      ['user_id', 'u1'],
      ['key', 'professionals.list_filters'],
    ])
  })

  it('is null without a row, or for a value that is not an object', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    await expect(fetchUserPreference('u1', 'k')).resolves.toBeNull()
    mocks.maybeSingle.mockResolvedValueOnce({ data: { value: ['x'] }, error: null })
    await expect(fetchUserPreference('u1', 'k')).resolves.toBeNull()
  })

  it('throws the error', async () => {
    const error = { code: '42501', message: 'denied' }
    mocks.maybeSingle.mockResolvedValue({ data: null, error })
    await expect(fetchUserPreference('u1', 'k')).rejects.toBe(error)
  })
})

describe('saveUserPreference / deleteUserPreference', () => {
  it('write through the RPCs, never the table, naming the user who made the change', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await saveUserPreference('u1', 'k', { query: 'q=a' })
    await deleteUserPreference('u1', 'k')
    expect(mocks.rpc.mock.calls).toEqual([
      ['set_user_preference', { p_user_id: 'u1', p_key: 'k', p_value: { query: 'q=a' } }],
      ['delete_user_preference', { p_user_id: 'u1', p_key: 'k' }],
    ])
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('throw the RPC error', async () => {
    const error = { code: '22023', message: 'Au plus 50 préférences par utilisateur' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(saveUserPreference('u1', 'k', {})).rejects.toBe(error)
    await expect(deleteUserPreference('u1', 'k')).rejects.toBe(error)
  })
})
