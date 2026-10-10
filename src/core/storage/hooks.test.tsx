import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '@/core/auth/auth-context'
import { FunctionCallError } from '@/core/supabase/functions'
import { storageKeys, useSignedFileUrl, useSignedFileUrls } from './hooks'

const mocks = vi.hoisted(() => ({ signedFileUrl: vi.fn(), signedFileUrls: vi.fn() }))
vi.mock('./api', () => ({ SIGN_BATCH_MAX: 50, signedFileUrl: mocks.signedFileUrl, signedFileUrls: mocks.signedFileUrls }))

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

  it('a variant (a smaller copy) is asked for by name and cached apart from the original', async () => {
    mocks.signedFileUrl.mockResolvedValueOnce(signed(1)).mockResolvedValueOnce(signed(2))
    const { wrapper, queryClient } = setup()
    const small = renderHook(() => useSignedFileUrl(FILE_ID, { variant: 'avatar' }), { wrapper })
    await waitFor(() => expect(small.result.current.data).toEqual(signed(1)))
    expect(mocks.signedFileUrl).toHaveBeenCalledWith(FILE_ID, { signal: expect.any(AbortSignal), variant: 'avatar' })
    const original = renderHook(() => useSignedFileUrl(FILE_ID), { wrapper })
    await waitFor(() => expect(original.result.current.data).toEqual(signed(2)))
    expect(queryClient.getQueryData(storageKeys.signedUrl('u1', FILE_ID, 'avatar'))).toEqual(signed(1))
    expect(queryClient.getQueryData(storageKeys.signedUrl('u1', FILE_ID))).toEqual(signed(2))
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

describe('useSignedFileUrls', () => {
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const urlOf = (id: string, n = 1) => `https://x.test/object/sign/${id}?token=${n}`
  /** storage-sign's batch: every id readable but those in `hidden`. */
  const answer = (hidden: string[] = [], n = 1) => (ids: readonly string[]) =>
    Promise.resolve({ urls: new Map(ids.filter((id) => !hidden.includes(id)).map((id) => [id, urlOf(id, n)])), expiresAt: '2026-10-08T12:05:00.000Z' })

  it('asks for nothing without files', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useSignedFileUrls([]), { wrapper })
    expect(result.current.urls.size).toBe(0)
    expect(mocks.signedFileUrls).not.toHaveBeenCalled()
  })

  it('signs the files in one call, keyed by the user; an unreadable one is simply absent', async () => {
    mocks.signedFileUrls.mockImplementation(answer([ID(2)]))
    const { wrapper, queryClient } = setup()
    const { result } = renderHook(() => useSignedFileUrls([ID(2), ID(1), ID(1)]), { wrapper })
    await waitFor(() => expect(result.current.urls.get(ID(1))).toBe(urlOf(ID(1))))
    expect(result.current.urls.has(ID(2))).toBe(false)
    expect(mocks.signedFileUrls).toHaveBeenCalledExactlyOnceWith([ID(1), ID(2)], { signal: expect.any(AbortSignal) })
    expect(queryClient.getQueryData(storageKeys.signedUrls('u1', [ID(1), ID(2)]))).toBeDefined()
  })

  it('rows coming into view add a batch of their own: the files already signed are not asked for again', async () => {
    mocks.signedFileUrls.mockImplementation(answer())
    const { wrapper } = setup()
    const { result, rerender } = renderHook(({ ids }) => useSignedFileUrls(ids), { wrapper, initialProps: { ids: [ID(1), ID(2)] } })
    await waitFor(() => expect(result.current.urls.size).toBe(2))
    rerender({ ids: [ID(1), ID(2), ID(3)] })
    await waitFor(() => expect(result.current.urls.size).toBe(3))
    expect(mocks.signedFileUrls.mock.calls.map(([ids]) => ids)).toEqual([[ID(1), ID(2)], [ID(3)]])
  })

  it('splits more than 50 files into batches of 50', async () => {
    mocks.signedFileUrls.mockImplementation(answer())
    const { wrapper } = setup()
    const ids = Array.from({ length: 120 }, (_, i) => ID(i + 1))
    const { result } = renderHook(() => useSignedFileUrls(ids), { wrapper })
    await waitFor(() => expect(result.current.urls.size).toBe(120))
    expect(mocks.signedFileUrls.mock.calls.map(([batch]) => batch.length)).toEqual([50, 50, 20])
  })

  it('refetchFor asks again for that file’s batch only, once even when several images fail together', async () => {
    mocks.signedFileUrls.mockImplementation(answer())
    const { wrapper } = setup()
    const { result, rerender } = renderHook(({ ids }) => useSignedFileUrls(ids), { wrapper, initialProps: { ids: [ID(1)] } })
    await waitFor(() => expect(result.current.urls.size).toBe(1))
    rerender({ ids: [ID(1), ID(2)] })
    await waitFor(() => expect(result.current.urls.size).toBe(2))
    mocks.signedFileUrls.mockClear()
    mocks.signedFileUrls.mockImplementation(answer([], 2))
    let outcomes: { isError: boolean }[] = []
    await act(async () => {
      outcomes = await Promise.all([result.current.refetchFor(ID(2)), result.current.refetchFor(ID(2))])
    })
    expect(outcomes).toEqual([{ isError: false }, { isError: false }])
    expect(mocks.signedFileUrls).toHaveBeenCalledExactlyOnceWith([ID(2)], { signal: expect.any(AbortSignal) })
    await waitFor(() => expect(result.current.urls.get(ID(2))).toBe(urlOf(ID(2), 2)))
    expect(result.current.urls.get(ID(1))).toBe(urlOf(ID(1)))
    await act(async () => expect(await result.current.refetchFor(ID(9))).toEqual({ isError: true }))
  })

  it('a variant is asked for by name and cached apart from the originals', async () => {
    mocks.signedFileUrls.mockImplementation(answer())
    const { wrapper, queryClient } = setup()
    const { result } = renderHook(() => useSignedFileUrls([ID(1)], { variant: 'avatar' }), { wrapper })
    await waitFor(() => expect(result.current.urls.size).toBe(1))
    expect(mocks.signedFileUrls).toHaveBeenCalledExactlyOnceWith([ID(1)], { signal: expect.any(AbortSignal), variant: 'avatar' })
    expect(queryClient.getQueryData(storageKeys.signedUrls('u1', [ID(1)], 'avatar'))).toBeDefined()
    expect(queryClient.getQueryData(storageKeys.signedUrls('u1', [ID(1)]))).toBeUndefined()
  })

  it('a record opened from the list reuses the URL its row signed (same user, same size): no new call, the same URL', async () => {
    mocks.signedFileUrls.mockImplementation(answer())
    const { wrapper } = setup()
    const list = renderHook(() => useSignedFileUrls([ID(1), ID(2)], { variant: 'avatar' }), { wrapper })
    await waitFor(() => expect(list.result.current.urls.size).toBe(2))
    const header = renderHook(() => useSignedFileUrl(ID(2), { variant: 'avatar' }), { wrapper })
    expect(header.result.current.data).toEqual({ url: urlOf(ID(2)), expiresAt: '2026-10-08T12:05:00.000Z' })
    expect(header.result.current.isStale).toBe(false)
    expect(mocks.signedFileUrl).not.toHaveBeenCalled()

    // Another size, or the original, is signed on its own.
    mocks.signedFileUrl.mockResolvedValue(signed(7))
    const original = renderHook(() => useSignedFileUrl(ID(2)), { wrapper })
    await waitFor(() => expect(original.result.current.data).toEqual(signed(7)))
    expect(mocks.signedFileUrl).toHaveBeenCalledExactlyOnceWith(ID(2), { signal: expect.any(AbortSignal) })
  })

  it("another user's batch is never reused", async () => {
    mocks.signedFileUrls.mockImplementation(answer())
    mocks.signedFileUrl.mockResolvedValue(signed(4))
    const { wrapper, signIn } = setup()
    const list = renderHook(() => useSignedFileUrls([ID(1)], { variant: 'avatar' }), { wrapper })
    await waitFor(() => expect(list.result.current.urls.size).toBe(1))
    signIn('u2')
    const header = renderHook(() => useSignedFileUrl(ID(1), { variant: 'avatar' }), { wrapper })
    await waitFor(() => expect(header.result.current.data).toEqual(signed(4)))
  })

  it('a list URL 4 minutes old is not reused: the record signs a fresh one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.signedFileUrls.mockImplementation(answer())
    mocks.signedFileUrl.mockResolvedValue(signed(3))
    const { wrapper } = setup()
    const list = renderHook(() => useSignedFileUrls([ID(1)], { variant: 'avatar' }), { wrapper })
    await waitFor(() => expect(list.result.current.urls.size).toBe(1))
    await act(() => vi.advanceTimersByTimeAsync(240_000))
    const header = renderHook(() => useSignedFileUrl(ID(1), { variant: 'avatar' }), { wrapper })
    await waitFor(() => expect(header.result.current.data).toEqual(signed(3)))
    expect(mocks.signedFileUrl).toHaveBeenCalledExactlyOnceWith(ID(1), { signal: expect.any(AbortSignal), variant: 'avatar' })
  })

  it('a 429 is not retried, and a new user signs again under their own key', async () => {
    mocks.signedFileUrls.mockRejectedValue(new FunctionCallError('rate_limited', 429, 'Too many'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useSignedFileUrls([ID(1)]), { wrapper })
    await waitFor(() => expect(mocks.signedFileUrls).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.signedFileUrls).toHaveBeenCalledTimes(1)
    expect(result.current.urls.size).toBe(0)
  })
})
