import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAuthUser, updateDisplayName } from './api'

const mocks = vi.hoisted(() => {
  const select = vi.fn()
  const eq = vi.fn(() => ({ select }))
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  const getUser = vi.fn()
  return { from, update, eq, select, getUser }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }))

afterEach(() => vi.clearAllMocks())

describe('updateDisplayName', () => {
  it("renames the caller's own profile, trimmed", async () => {
    mocks.select.mockResolvedValue({ data: [{ user_id: 'u1' }], error: null })
    await expect(updateDisplayName('u1', '  Camille Tremblay  ')).resolves.toBeUndefined()
    expect(mocks.from).toHaveBeenCalledWith('profiles')
    expect(mocks.update).toHaveBeenCalledWith({ display_name: 'Camille Tremblay' })
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(mocks.select).toHaveBeenCalledWith('user_id')
  })

  it('throws the database error', async () => {
    const error = { code: '23514', message: 'new row for relation "profiles" violates check constraint' }
    mocks.select.mockResolvedValue({ data: null, error })
    await expect(updateDisplayName('u1', 'Camille')).rejects.toBe(error)
  })

  // RLS refuses silently (0 rows): a disabled profile, or another user's id.
  it('throws a permission error when no row was updated', async () => {
    mocks.select.mockResolvedValue({ data: [], error: null })
    await expect(updateDisplayName('u2', 'Camille')).rejects.toMatchObject({ code: '42501' })
  })
})

describe('fetchAuthUser', () => {
  // The stored session keeps the user as it was at sign-in or the last refresh.
  it("reads the signed-in user from the server", async () => {
    const user = { id: 'u1', email: 'nouvelle@mana.test' }
    mocks.getUser.mockResolvedValue({ data: { user }, error: null })
    await expect(fetchAuthUser()).resolves.toBe(user)
  })

  it('throws the auth error', async () => {
    const error = new Error('Auth session missing!')
    mocks.getUser.mockResolvedValue({ data: { user: null }, error })
    await expect(fetchAuthUser()).rejects.toBe(error)
  })
})
