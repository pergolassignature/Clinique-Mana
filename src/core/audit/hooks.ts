import { useEffect } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { AUDIT_PAGE_SIZE, fetchAuditActors, fetchAuditEntries, type AuditFilters } from './api'

export const auditKeys = {
  all: ['audit'] as const,
  entriesAll: () => [...auditKeys.all, 'entries'] as const,
  entries: (filters: AuditFilters) => [...auditKeys.entriesAll(), filters] as const,
  actors: () => [...auditKeys.all, 'actors'] as const,
}

/**
 * The journal, page by page, newest first. Each filter combination is its own query, so changing
 * a filter starts again from the newest page. A full page means there may be more: the next page
 * starts before its last id. A shorter page is the beginning of the journal.
 *
 * Freshness: always stale (`staleTime: 0`, the app default is 2 min), and removed as soon as the
 * page unmounts (removed on unmount; `gcTime: 0` for a filter left behind), so coming back loads one fresh page rather than refetching every
 * page loaded before. No refetch on window focus, for the same reason. A refetch (« Réessayer »)
 * reloads the loaded pages in turn, each starting before the last id of the page refetched just
 * before it (React Query recomputes the params), so a new row shifts the pages without a gap.
 *
 * Caveats of the keyset on `id`:
 * - ids are taken when a row is inserted, but rows become visible when their transaction commits:
 *   a longer transaction can commit a lower id after newer rows were loaded. That row appears on
 *   the next fresh load, not in pages already shown.
 * - the order is by `id`, while « Date » is `created_at` (the transaction's start time): two rows
 *   from overlapping transactions can show their times slightly out of order.
 */
export function useAuditEntries(filters: AuditFilters) {
  const queryClient = useQueryClient()
  // Removed right away, not on the next tick as `gcTime: 0` would: a quick return still starts fresh.
  useEffect(() => () => queryClient.removeQueries({ queryKey: auditKeys.entriesAll() }), [queryClient])
  return useInfiniteQuery({
    queryKey: auditKeys.entries(filters),
    queryFn: ({ pageParam }) => fetchAuditEntries(filters, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => (lastPage.length === AUDIT_PAGE_SIZE ? lastPage[lastPage.length - 1]?.id : undefined),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
}

/** The people of the org who appear in the journal (« Personne »). */
export function useAuditActors() {
  // Always stale: a person who just acted for the first time shows up when the page is opened again.
  return useQuery({ queryKey: auditKeys.actors(), queryFn: fetchAuditActors, staleTime: 0 })
}
