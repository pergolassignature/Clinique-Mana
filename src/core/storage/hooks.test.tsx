import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '@/core/auth/auth-context'
import { FunctionCallError } from '@/core/supabase/functions'
import { storageKeys, useSignedFileUrl } from './hooks'

const mocks = vi.hoisted(() => ({ signedFileUrl: vi.fn() }))
vi.mock('./api', () => ({ signedFileUrl: mocks.signedFileUrl }))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const FILE_ID = '11111111-1111-4111-8111-111111111111'
const signed = (n: number) => ({ url: `https://x.test/object/sign/a?token=${n}`, expiresAt: '2026-10-08T12:05:00.000Z' })

function setup() {
  const queryClient = new QueryClient()
  let userId = 'u1'
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ session: { user: { id: userId } } as Session } as AuthContextValue}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  )
  return { queryClient, wrapper, signIn: (id: string) => (userId = id) }
}

describe('useSignedFileUrl', () => {
  it('asks for nothing without a file', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useSignedFileUrl(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(mocks.signedFileUrl).not.toHaveBeenCalled()
  })

  it("signs the file's read URL, keyed by the signed-in user", async () => {
    mocks.signedFileUrl.mockResolvedValue(signed(1))
    const { wrapper, queryClient } = setup()
    const { result } = renderHook(() => useSignedFileUrl(FILE_ID), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(signed(1)))
    expect(mocks.signedFileUrl).toHaveBeenCalledWith(FILE_ID, { signal: expect.any(AbortSignal) })
    expect(queryClient.getQueryData(storageKeys.signedUrl('u1', FILE_ID))).toEqual(signed(1))
  })

  it('with refresh (a download link), gets a new URL after 4 minutes, before the 5-minute one expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.signedFileUrl.mockResolvedValueOnce(signed(1)).mockResolvedValue(signed(2))
    const { wrapper } = setup()
    const { result } = renderHook(() => useSignedFileUrl(FILE_ID, { refresh: true }), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(signed(1)))
    await act(() => vi.advanceTimersByTimeAsync(239_000))
    expect(mocks.signedFileUrl).toHaveBeenCalledTimes(1)
    expect(result.current.isStale).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    await waitFor(() => expect(result.current.data).toEqual(signed(2)))
  })

  it('without refresh (an image), keeps its URL while shown: an image already loaded is not reloaded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.signedFileUrl.mockResolvedValueOnce(signed(1)).mockResolvedValue(signed(2))
    const { wrapper } = setup()
    const { result } = renderHook(() => useSignedFileUrl(FILE_ID), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(signed(1)))
    await act(() => vi.advanceTimersByTimeAsync(600_000))
    expect(mocks.signedFileUrl).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(signed(1))
  })

  it("never serves one user's URL to the next", async () => {
    mocks.signedFileUrl.mockResolvedValueOnce(signed(1)).mockReturnValueOnce(new Promise(() => {}))
    const { wrapper, signIn } = setup()
    const { result, rerender } = renderHook(() => useSignedFileUrl(FILE_ID), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(signed(1)))
    signIn('u2')
    rerender()
    expect(result.current.data).toBeUndefined()
    expect(mocks.signedFileUrl).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['rate_limited', 429],
    ['not_found', 404],
  ])('does not retry a %s', async (code, status) => {
    mocks.signedFileUrl.mockRejectedValue(new FunctionCallError(code, status, 'x'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useSignedFileUrl(FILE_ID), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.signedFileUrl).toHaveBeenCalledTimes(1)
  })
})
