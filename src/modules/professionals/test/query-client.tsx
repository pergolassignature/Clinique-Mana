import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * A fresh client without retries, its wrapper, and spies on invalidation. Test-only. `appDefaults`
 * takes the app's freshness (App.tsx: data fresh for 2 min), for tests about refetching.
 */
export function setupQueryClient({ appDefaults = false }: { appDefaults?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, ...(appDefaults && { staleTime: 2 * 60_000 }) }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  /** The query keys invalidated so far. */
  const invalidated = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey)
  return { queryClient, wrapper, invalidate, invalidated }
}
