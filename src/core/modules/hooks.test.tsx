import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { accessKeys } from '@/core/access/access-context'
import { moduleKeys, useSetModuleEnabled } from './hooks'

const mocks = vi.hoisted(() => ({ fetchModules: vi.fn(), setModuleEnabled: vi.fn() }))
vi.mock('./api', () => mocks)

afterEach(() => vi.clearAllMocks())

describe('useSetModuleEnabled', () => {
  it('invalidates the module list and the access payload on success', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    mocks.setModuleEnabled.mockResolvedValue(undefined)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSetModuleEnabled(), { wrapper })
    result.current.mutate({ key: 'professionals', enabled: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.setModuleEnabled).toHaveBeenCalledWith('professionals', true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moduleKeys.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all })
  })
})
