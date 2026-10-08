import { QueryCache, QueryClient } from '@tanstack/react-query'
import { accessKeys } from '@/core/access/access-context'

/**
 * A refusal for lack of permission (SQLSTATE `42501`, as PostgREST reports it). Retrying it cannot
 * help: the caller's rights changed (another admin, another tab) or the query should not have run.
 * Read here without `@/core/modules/errors`, which is not on the login page's entry chunk.
 */
export function isPermissionRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42501'
}

/** One access refetch per burst: a page's queries refused together refetch it once. */
export const ACCESS_REFRESH_BURST_MS = 2_000

/**
 * The app's QueryClient. Queries are fresh 2 min, kept 5 min, retried once, except a `42501`.
 * A query refused with `42501` refetches the caller's access (`accessKeys.all`), at most once per
 * burst: the screens then hide what the new rights no longer allow, as a mutation refused the same
 * way already does. The access query's own failures are AccessProvider's.
 */
export function createQueryClient(): QueryClient {
  let lastAccessRefresh = Number.NEGATIVE_INFINITY
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!isPermissionRefusal(error) || query.queryKey[0] === accessKeys.all[0]) return
        const now = Date.now()
        if (now - lastAccessRefresh < ACCESS_REFRESH_BURST_MS) return
        lastAccessRefresh = now
        void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 2 * 60_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => failureCount < 1 && !isPermissionRefusal(error),
      },
    },
  })
  return queryClient
}
