import { useQuery } from '@tanstack/react-query'
import { fetchProfessionalsCatalog, fetchReferenceUsage } from '../api/catalog'
import { buildCatalogView } from '../lib/catalog-view'
import { professionalCatalogKeys } from './keys'

/** The lists change rarely (settings); every page of the module shares one cached payload. */
export const CATALOG_STALE_TIME = 5 * 60_000

/**
 * The nine lists with their lookups (`CatalogView`: `byId` maps, motif groups). The cache holds
 * the raw payload; `select` is a module-level function, so React Query builds the view once per
 * payload and every render gets the same object.
 */
export function useProfessionalsCatalog() {
  return useQuery({
    queryKey: professionalCatalogKeys.catalog(),
    queryFn: fetchProfessionalsCatalog,
    staleTime: CATALOG_STALE_TIME,
    select: buildCatalogView,
  })
}

/**
 * « Utilisé par » counts, keyed by `usageKey(kind, id)`. Needs `professionals.settings` or
 * `professionals.manage`: callers pass `enabled: false` otherwise.
 */
export function useReferenceUsage({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: professionalCatalogKeys.usage(), queryFn: fetchReferenceUsage, enabled })
}
