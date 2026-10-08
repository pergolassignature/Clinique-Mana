import { useQuery } from '@tanstack/react-query'
import { fetchPermissionCatalog } from './api'

/**
 * The permission catalogue (permissions and modules), one query for the whole app: the users
 * pages show it as switches, the audit log names permissions and modules with it. Its own root:
 * user and role changes never touch it.
 */
export const permissionCatalogKeys = {
  all: ['permission-catalog'] as const,
}

/** The catalogue changes only with a migration: fresh for five minutes. */
export function usePermissionCatalog() {
  return useQuery({ queryKey: permissionCatalogKeys.all, queryFn: fetchPermissionCatalog, staleTime: 5 * 60_000 })
}
