import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleKeys, useSetModuleEnabled } from './hooks'

const mocks = vi.hoisted(() => ({
  api: { fetchModules: vi.fn(), setModuleEnabled: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('./api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { queryClient, wrapper }
}

describe('useSetModuleEnabled', () => {
  it('invalidates the module list and the access payload, then confirms with a toast', async () => {
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    mocks.api.setModuleEnabled.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSetModuleEnabled(), { wrapper })
    result.current.mutate({ key: 'professionals', enabled: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.setModuleEnabled).toHaveBeenCalledWith('professionals', true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moduleKeys.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all })
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.modules.saved'))
  })

  it('stays pending until the invalidations resolve, and only then confirms', async () => {
    const { queryClient, wrapper } = setup()
    let release: () => void = () => {}
    const invalidations = new Promise<void>((resolve) => (release = resolve))
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(invalidations)
    mocks.api.setModuleEnabled.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSetModuleEnabled(), { wrapper })
    result.current.mutate({ key: 'professionals', enabled: true })
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2))
    expect(result.current.isPending).toBe(true)
    expect(mocks.toast.success).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.toast.success).toHaveBeenCalledTimes(1)
  })

  it('shows the refusal even if the page unmounted meanwhile', async () => {
    const { wrapper } = setup()
    let reject: (error: unknown) => void = () => {}
    mocks.api.setModuleEnabled.mockReturnValue(new Promise((_resolve, r) => (reject = r)))

    const { result, unmount } = renderHook(() => useSetModuleEnabled(), { wrapper })
    result.current.mutate({ key: 'professionals', enabled: false })
    await waitFor(() => expect(mocks.api.setModuleEnabled).toHaveBeenCalled())
    unmount()
    reject({ code: 'P0001', message: "Désactivez d'abord : Facturation" })

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Désactivez d'abord : Facturation"))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })
})
