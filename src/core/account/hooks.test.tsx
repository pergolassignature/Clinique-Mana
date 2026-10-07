import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { accountKeys, useAuthUser, useUpdateDisplayName } from './hooks'

const mocks = vi.hoisted(() => ({
  api: { updateDisplayName: vi.fn(), fetchAuthUser: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('./api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

function setup() {
  // The app's default staleTime (App.tsx), so the test shows useAuthUser overrides it.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 2 * 60_000 }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  return { queryClient, wrapper, invalidate }
}

describe('useUpdateDisplayName', () => {
  // The shell shows the name from get_my_access.
  it('saves, refreshes the access payload, then confirms', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.updateDisplayName.mockResolvedValue(undefined)
    const { result } = renderHook(() => useUpdateDisplayName(), { wrapper })
    result.current.mutate({ userId: 'u1', displayName: 'Camille' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.updateDisplayName).toHaveBeenCalledWith('u1', 'Camille')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all })
    expect(mocks.toast.success).toHaveBeenCalledWith(t('account.name.saved'))
  })

  it('shows the permission message when the profile could not be renamed', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.updateDisplayName.mockRejectedValue(Object.assign(new Error('no row updated'), { code: '42501' }))
    const { result } = renderHook(() => useUpdateDisplayName(), { wrapper })
    result.current.mutate({ userId: 'u1', displayName: 'Camille' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden'))
    expect(invalidate).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('falls back to the generic message, reported to Sentry', async () => {
    const { wrapper } = setup()
    mocks.api.updateDisplayName.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useUpdateDisplayName(), { wrapper })
    result.current.mutate({ userId: 'u1', displayName: 'Camille' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.generic'))
    expect(mocks.captureException).toHaveBeenCalled()
  })
})

describe('useAuthUser', () => {
  // Read again on every mount and focus: the user comes back from the mailbox after confirming.
  it("loads the user from GoTrue under the caller's key, always stale", async () => {
    const { queryClient, wrapper } = setup()
    const user = { id: 'u1', email: 'nouvelle@mana.test' }
    mocks.api.fetchAuthUser.mockResolvedValue(user)
    const { result } = renderHook(() => useAuthUser('u1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(user))
    expect(queryClient.getQueryData(accountKeys.authUser('u1'))).toBe(user)
    expect(result.current.isStale).toBe(true)
  })
})
