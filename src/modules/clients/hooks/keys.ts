import type { ClientsPageQuery } from '../api/clients'

/**
 * The module's query keys. Every write invalidates `all` (the list, the records, « Mes clients »
 * and the reference lists are cheap to refetch at the clinic's size), except the live duplicate
 * panel, which is never cached between keystrokes.
 */
export const clientsKeys = {
  all: ['clients'] as const,
  list: (query: ClientsPageQuery) => [...clientsKeys.all, 'list', query] as const,
  record: (id: string) => [...clientsKeys.all, 'record', id] as const,
  reference: () => [...clientsKeys.all, 'reference'] as const,
  mine: () => [...clientsKeys.all, 'mine'] as const,
  duplicates: (key: string) => [...clientsKeys.all, 'duplicates', key] as const,
  search: (query: string) => [...clientsKeys.all, 'search', query] as const,
}
