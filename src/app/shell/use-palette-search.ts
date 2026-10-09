import { useQueries } from '@tanstack/react-query'
import { useAccess } from '@/core/access/access-context'
import type { ModuleSearchProvider, ModuleSearchResult } from '@/core/modules/types'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'

/** The pause after the last keystroke before the modules are asked. */
export const PALETTE_SEARCH_DEBOUNCE_MS = 200
/** Characters (spaces aside) before a provider without `minChars` is asked. */
export const PALETTE_SEARCH_MIN_CHARS = 2
/** Results are kept this long once the palette no longer shows them (short: they name people). */
const RESULTS_GC_MS = 30_000

/**
 * The global search's results: keyed per signed-in user, so one account never sees another's
 * results from the cache (AccessProvider also clears the cache when the user changes), and per
 * provider and query. Never invalidated: they expire (`gcTime` 30 s).
 */
export const paletteSearchKeys = {
  all: ['palette-search'] as const,
  results: (userId: string, providerId: string, query: string) => [...paletteSearchKeys.all, userId, providerId, query] as const,
}

export type PaletteSearchStatus = 'idle' | 'loading' | 'error' | 'done'

export interface PaletteSearchGroup {
  provider: ModuleSearchProvider
  /** idle: the query is too short for this provider (nothing asked). */
  status: PaletteSearchStatus
  results: ModuleSearchResult[]
}

/** The query as sent: trimmed, inner spaces collapsed. */
export const normalizeQuery = (query: string) => query.trim().replace(/\s+/g, ' ')

const isLongEnough = (query: string, provider: ModuleSearchProvider) =>
  query.replace(/\s/g, '').length >= (provider.minChars ?? PALETTE_SEARCH_MIN_CHARS)

/**
 * Asks every provider for `query`, PALETTE_SEARCH_DEBOUNCE_MS after the last keystroke. A newer
 * query cancels the request of the previous one (React Query aborts the signal of a query nobody
 * observes any more), and so does closing the palette, which unmounts the caller. A group is
 * `loading` from the keystroke until its answer, so « Aucun résultat » never shows early.
 */
export function usePaletteSearch(providers: readonly ModuleSearchProvider[], rawQuery: string): PaletteSearchGroup[] {
  const userId = useAccess().access?.user_id ?? ''
  const query = normalizeQuery(rawQuery)
  const debounced = useDebouncedValue(query, PALETTE_SEARCH_DEBOUNCE_MS)
  const settled = debounced === query

  const queries = useQueries({
    queries: providers.map((provider) => ({
      queryKey: paletteSearchKeys.results(userId, provider.id, debounced),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const search = await provider.load()
        return search(debounced, signal)
      },
      enabled: userId !== '' && isLongEnough(debounced, provider),
      staleTime: RESULTS_GC_MS,
      gcTime: RESULTS_GC_MS,
      retry: false,
    })),
  })

  return providers.map((provider, i) => {
    const q = queries[i]
    if (!q || userId === '' || !isLongEnough(query, provider)) return { provider, status: 'idle', results: [] }
    if (!settled || q.isPending) return { provider, status: 'loading', results: [] }
    if (q.isError) return { provider, status: 'error', results: [] }
    return { provider, status: 'done', results: q.data ?? [] }
  })
}
