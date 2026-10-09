import { useEffect } from 'react'
import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { fetchProfessionalHistory, PROFESSIONAL_HISTORY_PAGE_SIZE } from '../api/history'
import { fetchProfessionalRecord } from '../api/record'
import type { HistoryEntry } from '../api/parse'
import { professionalKeys } from './keys'

/** The record page's one request (`get_professional_record`); null when the caller cannot read it. */
const recordQuery = (id: string) => queryOptions({ queryKey: professionalKeys.record(id), queryFn: () => fetchProfessionalRecord(id) })

/** The record, or null (not found / not readable). Run it in parallel with `useProfessionalsCatalog`. */
export function useProfessionalRecord(id: string) {
  return useQuery({ ...recordQuery(id), enabled: id !== '' })
}

/** Starts loading a record before it is opened (list row hover or focus). A fresh one is not refetched. */
export function prefetchProfessionalRecord(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(recordQuery(id))
}

/**
 * The history, page by page, newest first (keyset on the audit id). Fetched when the tab opens,
 * or before on tab hover (`prefetchProfessionalHistory`): fresh for 30 s so that prefetch is used,
 * and every record change refreshes it (`refreshProfessionalHistory`). A refetch of an infinite
 * query reloads every page it holds, so the cache keeps only the first page whenever the tab is
 * left or the history is refreshed: a remount or a refresh then reads one page, and « Charger
 * plus » reads on from there. No refetch on window focus.
 */
const historyQuery = (id: string) =>
  infiniteQueryOptions({
    queryKey: professionalKeys.history(id),
    queryFn: ({ pageParam }) => fetchProfessionalHistory(id, pageParam ?? undefined),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => (lastPage.length === PROFESSIONAL_HISTORY_PAGE_SIZE ? lastPage.at(-1)?.id : undefined),
    staleTime: 30_000,
  })

type HistoryPages = InfiniteData<HistoryEntry[], number | null>

/**
 * Keeps only the first page in the cache. `setState` changes the data alone: the query stays as
 * stale (or invalidated) as it was, so the next mount refetches it when it should, one page.
 */
function keepFirstHistoryPage(queryClient: QueryClient, id: string): void {
  const query = queryClient.getQueryCache().find<HistoryEntry[], Error, HistoryPages>({ queryKey: professionalKeys.history(id), exact: true })
  const data = query?.state.data
  if (!query || !data || data.pages.length <= 1) return
  query.setState({ data: { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } })
}

export function useProfessionalHistory(id: string) {
  const queryClient = useQueryClient()
  // Leaving the tab: the pages read with « Charger plus » are dropped, so a remount reloads one.
  useEffect(() => () => keepFirstHistoryPage(queryClient, id), [queryClient, id])
  return useInfiniteQuery({ ...historyQuery(id), enabled: id !== '', refetchOnWindowFocus: false })
}

/** After a record change: the first page only is refetched (the new entries are at its top). */
export function refreshProfessionalHistory(queryClient: QueryClient, id: string): Promise<void> {
  keepFirstHistoryPage(queryClient, id)
  return queryClient.invalidateQueries({ queryKey: professionalKeys.history(id) })
}

/** Starts loading the first history page (Historique tab hover or focus). */
export function prefetchProfessionalHistory(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchInfiniteQuery(historyQuery(id))
}
