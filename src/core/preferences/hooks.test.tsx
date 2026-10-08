import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, type AccessContextValue } from '@/core/access/access-context'
import { testAccess } from '@/test/contexts'
import { PREFERENCE_WRITE_DELAY, preferenceKeys, usePreferenceWriter, useUserPreference } from './hooks'

const mocks = vi.hoisted(() => ({ fetchUserPreference: vi.fn(), saveUserPreference: vi.fn(), deleteUserPreference: vi.fn() }))
vi.mock('./api', () => mocks)

const KEY = 'professionals.list_filters'
const access: AccessContextValue = {
  status: 'ready',
  access: testAccess,
  problem: null,
  can: () => false,
  reload: () => {},
  isReloading: false,
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AccessContext.Provider value={access}>{children}</AccessContext.Provider>
    </QueryClientProvider>
  )
  return { queryClient, wrapper, cached: () => queryClient.getQueryData(preferenceKeys.one(testAccess.user_id, KEY)) }
}

beforeEach(() => {
  mocks.fetchUserPreference.mockResolvedValue(null)
  mocks.saveUserPreference.mockResolvedValue(undefined)
  mocks.deleteUserPreference.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useUserPreference', () => {
  it('reads the signed-in user’s value, under a key that names the user', async () => {
    mocks.fetchUserPreference.mockResolvedValue({ query: 'statut=actif' })
    const { wrapper, cached } = setup()
    const { result } = renderHook(() => useUserPreference(KEY), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ query: 'statut=actif' }))
    expect(mocks.fetchUserPreference).toHaveBeenCalledWith(testAccess.user_id, KEY)
    expect(cached()).toEqual({ query: 'statut=actif' })
  })

  it('does not retry a failed read', async () => {
    mocks.fetchUserPreference.mockRejectedValue(new Error('network'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useUserPreference(KEY), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.fetchUserPreference).toHaveBeenCalledTimes(1)
  })
})

describe('usePreferenceWriter', () => {
  it('updates the cache at once and writes once after a burst of changes', async () => {
    vi.useFakeTimers()
    const { wrapper, cached } = setup()
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => {
      result.current.schedule({ query: 'q=m' })
      result.current.schedule({ query: 'q=ma' })
    })
    expect(cached()).toEqual({ query: 'q=ma' })
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY - 1))
    expect(mocks.saveUserPreference).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(KEY, { query: 'q=ma' })
  })

  it('forgets the preference for null', async () => {
    vi.useFakeTimers()
    const { wrapper } = setup()
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule(null))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.deleteUserPreference).toHaveBeenCalledExactlyOnceWith(KEY)
  })

  it('skips a write when the value comes back to what the server holds', async () => {
    vi.useFakeTimers()
    const { wrapper, queryClient } = setup()
    queryClient.setQueryData(preferenceKeys.one(testAccess.user_id, KEY), { query: 'statut=actif' })
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => {
      result.current.schedule({ query: 'statut=inactif' })
      result.current.schedule({ query: 'statut=actif' })
    })
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).not.toHaveBeenCalled()
  })

  it('writes what waits when the page unmounts', async () => {
    const { wrapper } = setup()
    const { result, unmount } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    unmount()
    await waitFor(() => expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(KEY, { query: 'q=a' }))
  })

  it('a failed write is quiet and re-reads the stored value', async () => {
    vi.useFakeTimers()
    mocks.saveUserPreference.mockRejectedValueOnce({ code: '42501', message: 'Permission refusée' })
    const { wrapper, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: preferenceKeys.one(testAccess.user_id, KEY) })
    // The server's value is unknown now: the same value is written again rather than skipped.
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).toHaveBeenCalledTimes(2)
  })

  it('writes one value after the other', async () => {
    vi.useFakeTimers()
    let release = () => {}
    mocks.saveUserPreference.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
    const { wrapper } = setup()
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    act(() => result.current.schedule({ query: 'q=b' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).toHaveBeenCalledTimes(1)
    await act(async () => release())
    expect(mocks.saveUserPreference).toHaveBeenLastCalledWith(KEY, { query: 'q=b' })
  })
})
