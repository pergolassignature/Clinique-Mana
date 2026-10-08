import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query'
import { fetchProfessionalHistory, PROFESSIONAL_HISTORY_PAGE_SIZE } from '../api/history'
import { fetchProfessionalRecord } from '../api/record'
import type { ProfessionalRecord } from '../api/parse'
import { professionalKeys } from './keys'

/** The record page's one request (`get_professional_record`); null when the caller cannot read it. */
const recordQuery = (id: string) => queryOptions({ queryKey: professionalKeys.record(id), queryFn: () => fetchProfessionalRecord(id) })

/** The record, or null (not found / not readable). Run it in parallel with `useProfessionalsCatalog`. */
export function useProfessionalRecord(id: string) {
  return useQuery({ ...recordQuery(id), enabled: id !== '' })
}

const selectReadiness = (record: ProfessionalRecord | null) => record?.readiness ?? null

/** Readiness, read from the record query (same cache entry): no request of its own. */
export function useProfessionalReadiness(id: string) {
  return useQuery({ ...recordQuery(id), enabled: id !== '', select: selectReadiness })
}

/** Starts loading a record before it is opened (list row hover or focus). A fresh one is not refetched. */
export function prefetchProfessionalRecord(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(recordQuery(id))
}

/**
 * The history, page by page, newest first (keyset on the audit id). Fetched when the tab opens,
 * or before on tab hover (`prefetchProfessionalHistory`): fresh for 30 s so that prefetch is used,
 * and every record change invalidates it. No refetch on window focus (it would reload every page).
 */
const historyQuery = (id: string) =>
  infiniteQueryOptions({
    queryKey: professionalKeys.history(id),
    queryFn: ({ pageParam }) => fetchProfessionalHistory(id, pageParam ?? undefined),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => (lastPage.length === PROFESSIONAL_HISTORY_PAGE_SIZE ? lastPage.at(-1)?.id : undefined),
    staleTime: 30_000,
  })

export function useProfessionalHistory(id: string) {
  return useInfiniteQuery({ ...historyQuery(id), enabled: id !== '', refetchOnWindowFocus: false })
}

/** Starts loading the first history page (Historique tab hover or focus). */
export function prefetchProfessionalHistory(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchInfiniteQuery(historyQuery(id))
}
