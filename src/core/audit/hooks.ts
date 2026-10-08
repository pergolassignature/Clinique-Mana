import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { AUDIT_PAGE_SIZE, fetchAuditActors, fetchAuditCatalog, fetchAuditEntries, type AuditFilters } from './api'

export const auditKeys = {
  all: ['audit'] as const,
  entries: (filters: AuditFilters) => [...auditKeys.all, 'entries', filters] as const,
  actors: () => [...auditKeys.all, 'actors'] as const,
  catalog: () => [...auditKeys.all, 'catalog'] as const,
}

/**
 * The journal, page by page, newest first. Each filter combination is its own query, so changing
 * a filter starts again from the newest page. A full page means there may be more: the next page
 * starts before its last id. A shorter page is the beginning of the journal.
 */
export function useAuditEntries(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.entries(filters),
    queryFn: ({ pageParam }) => fetchAuditEntries(filters, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => (lastPage.length === AUDIT_PAGE_SIZE ? lastPage[lastPage.length - 1]?.id : undefined),
  })
}

/** The people of the org who appear in the journal (« Personne »). */
export function useAuditActors() {
  return useQuery({ queryKey: auditKeys.actors(), queryFn: fetchAuditActors })
}

/**
 * Permission descriptions and module names for the details. They change only with migrations: kept
 * for the session. Optional: without them the details show the keys.
 */
export function useAuditCatalog() {
  return useQuery({ queryKey: auditKeys.catalog(), queryFn: fetchAuditCatalog, staleTime: Infinity })
}
