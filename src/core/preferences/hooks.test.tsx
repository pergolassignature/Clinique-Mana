import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, type AccessContextValue } from '@/core/access/access-context'
import { testAccess } from '@/test/contexts'
import { PREFERENCE_WRITE_DELAY, preferenceKeys, usePreferenceWriter, useUserPreference } from './hooks'

const mocks = vi.hoisted(() => ({
  fetchUserPreference: vi.fn(),
  saveUserPreference: vi.fn(),
  deleteUserPreference: vi.fn(),
  onSessionUserChange: vi.fn(),
}))
vi.mock('./api', () => mocks)

const KEY = 'professionals.list_filters'
const U1 = testAccess.user_id
const U2 = 'u2'

/** The auth listeners the writers registered (`onSessionUserChange`): `sessionChanges(id)` plays an auth event. */
let sessionListeners: Array<(userId: string | null) => void> = []
const sessionChanges = (userId: string | null) => sessionListeners.forEach((listener) => listener(userId))

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // The signed-in user, changed by `signInAs` (a rerender of the same tree).
  let userId = U1
  const access = (): AccessContextValue => ({
    status: 'ready',
    access: { ...testAccess, user_id: userId },
    problem: null,
    can: () => false,
    reload: () => {},
    isReloading: false,
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AccessContext.Provider value={access()}>{children}</AccessContext.Provider>
    </QueryClientProvider>
  )
  return {
    queryClient,
    wrapper,
    cached: (user = U1) => queryClient.getQueryData(preferenceKeys.one(user, KEY)),
    signInAs: (next: string) => {
      userId = next
    },
  }
}

/** A save that waits for `release()`. */
function holdNextSave() {
  let release = () => {}
  mocks.saveUserPreference.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
  return () => release()
}

beforeEach(() => {
  sessionListeners = []
  mocks.fetchUserPreference.mockResolvedValue(null)
  mocks.saveUserPreference.mockResolvedValue(undefined)
  mocks.deleteUserPreference.mockResolvedValue(undefined)
  mocks.onSessionUserChange.mockImplementation((listener: (userId: string | null) => void) => {
    sessionListeners.push(listener)
    return () => {
      sessionListeners = sessionListeners.filter((l) => l !== listener)
    }
  })
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
    expect(mocks.fetchUserPreference).toHaveBeenCalledWith(U1, KEY)
    expect(cached()).toEqual({ query: 'statut=actif' })
  })

  it('does not retry a failed read', async () => {
    mocks.fetchUserPreference.mockRejectedValue(new Error('network'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useUserPreference(KEY), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.fetchUserPreference).toHaveBeenCalledTimes(1)
  })

  it('a read that resolves after a change made here keeps the change (the read is older)', async () => {
    let resolveRead: (value: unknown) => void = () => {}
    mocks.fetchUserPreference.mockReturnValue(new Promise((resolve) => (resolveRead = resolve)))
    const { wrapper, cached } = setup()
    const { result } = renderHook(() => ({ read: useUserPreference(KEY), writer: usePreferenceWriter(KEY) }), { wrapper })
    act(() => result.current.writer.schedule({ query: 'statut=inactif' }))
    await act(async () => resolveRead({ query: 'statut=actif' }))
    await waitFor(() => expect(result.current.read.isSuccess).toBe(true))
    expect(cached()).toEqual({ query: 'statut=inactif' })
    expect(result.current.read.data).toEqual({ query: 'statut=inactif' })
  })
})

describe('usePreferenceWriter', () => {
  it('updates the cache at once and writes once after a burst of changes, for the user who made them', async () => {
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
    expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(U1, KEY, { query: 'q=ma' })
  })

  it('forgets the preference for null', async () => {
    vi.useFakeTimers()
    const { wrapper } = setup()
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule(null))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.deleteUserPreference).toHaveBeenCalledExactlyOnceWith(U1, KEY)
  })

  it('skips a write when the value comes back to what the server holds', async () => {
    vi.useFakeTimers()
    const { wrapper, queryClient } = setup()
    queryClient.setQueryData(preferenceKeys.one(U1, KEY), { query: 'statut=actif' })
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
    await waitFor(() => expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(U1, KEY, { query: 'q=a' }))
  })

  it('writes what waits when the page is unloaded (pagehide)', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    act(() => void window.dispatchEvent(new Event('pagehide')))
    await waitFor(() => expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(U1, KEY, { query: 'q=a' }))
  })

  it('writes what waits when the page is hidden, not when it shows again', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    try {
      const { wrapper } = setup()
      const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
      act(() => result.current.schedule({ query: 'q=a' }))
      visibility.mockReturnValue('visible')
      act(() => void document.dispatchEvent(new Event('visibilitychange')))
      await Promise.resolve()
      expect(mocks.saveUserPreference).not.toHaveBeenCalled()
      visibility.mockReturnValue('hidden')
      act(() => void document.dispatchEvent(new Event('visibilitychange')))
      await waitFor(() => expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(U1, KEY, { query: 'q=a' }))
    } finally {
      visibility.mockRestore()
    }
  })

  it('stops listening once unmounted', async () => {
    const { wrapper } = setup()
    const { result, unmount } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    unmount()
    await waitFor(() => expect(mocks.saveUserPreference).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new Event('pagehide'))
    expect(sessionListeners).toEqual([])
    expect(mocks.saveUserPreference).toHaveBeenCalledTimes(1)
  })

  it('a failed write is quiet and re-reads the stored value', async () => {
    vi.useFakeTimers()
    mocks.saveUserPreference.mockRejectedValueOnce({ code: '42501', message: 'Permission refusée' })
    const { wrapper, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: preferenceKeys.one(U1, KEY) })
    // The server's value is unknown now: the same value is written again rather than skipped.
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).toHaveBeenCalledTimes(2)
  })

  it('drops a refusal for another user quietly (HINT user_mismatch): nothing re-read', async () => {
    vi.useFakeTimers()
    mocks.saveUserPreference.mockRejectedValueOnce({ code: '42501', message: 'Cette préférence appartient à un autre utilisateur.', hint: 'user_mismatch' })
    const { wrapper, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).toHaveBeenCalledTimes(1)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('writes one value after the other', async () => {
    vi.useFakeTimers()
    const release = holdNextSave()
    const { wrapper } = setup()
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    act(() => result.current.schedule({ query: 'q=b' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).toHaveBeenCalledTimes(1)
    await act(async () => release())
    expect(mocks.saveUserPreference).toHaveBeenLastCalledWith(U1, KEY, { query: 'q=b' })
  })
})

describe('usePreferenceWriter — another user', () => {
  it('drops a write queued behind a slow one when the user changes: nothing is sent for the new user', async () => {
    vi.useFakeTimers()
    const release = holdNextSave()
    const { wrapper, signInAs } = setup()
    const { result, rerender } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    // U1's second change waits behind the first write.
    act(() => result.current.schedule({ query: 'q=b' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    signInAs(U2)
    rerender()
    await act(async () => release())
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(U1, KEY, { query: 'q=a' })
    expect(mocks.saveUserPreference).not.toHaveBeenCalledWith(U2, expect.anything(), expect.anything())
  })

  it('drops a queued write when auth reports another user (another tab switched the shared session)', async () => {
    vi.useFakeTimers()
    const release = holdNextSave()
    const { wrapper } = setup()
    const { result, unmount } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    act(() => result.current.schedule({ query: 'q=b' }))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    act(() => sessionChanges(U2))
    unmount()
    await act(async () => release())
    expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(U1, KEY, { query: 'q=a' })
  })

  it('drops what waits on a sign-out, so leaving the page writes nothing', async () => {
    vi.useFakeTimers()
    const { wrapper } = setup()
    const { result, unmount } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    act(() => sessionChanges(null))
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).not.toHaveBeenCalled()
  })

  it('ignores auth events for the same user (token refresh)', async () => {
    vi.useFakeTimers()
    const { wrapper } = setup()
    const { result } = renderHook(() => usePreferenceWriter(KEY), { wrapper })
    act(() => result.current.schedule({ query: 'q=a' }))
    act(() => sessionChanges(U1))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(U1, KEY, { query: 'q=a' })
  })
})
