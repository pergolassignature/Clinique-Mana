import type { ProfessionalsPageQuery } from '../api/list'

/**
 * React Query keys of the module, three roots so a change refetches only what it touched
 * (narrow invalidation, as `roleKeys` / `userKeys` in core):
 *
 * | Change                                   | Invalidated                                                    |
 * |------------------------------------------|----------------------------------------------------------------|
 * | a record's field, set, email or status   | `record(id)` (after writing the returned set), `lists()`,      |
 * |                                          | `history(id)`; sets and status also `usage()` (« Utilisé par ») |
 * | creation                                 | `lists()`, `usage()`                                           |
 * | a list row saved                         | `catalog()`, `usage()`; `professionalKeys.all` for titles and  |
 * |                                          | motifs (licence and restricted rules change readiness)         |
 * | a list row archived or restored          | `catalog()`, `usage()`, `professionalKeys.all` (readiness counts |
 * |                                          | active rows only)                                              |
 * | a list reordered                         | `catalog()` (optimistic, rolled back on error)                 |
 * | module settings                          | none: the RPC returns the effective settings, written as is    |
 *
 * Labels never live in records or list rows (ids only), so a rename touches the catalogue alone.
 */
export const professionalKeys = {
  all: ['professionals'] as const,
  /** Every list query: the whole list and the keyset pages. */
  lists: () => [...professionalKeys.all, 'list'] as const,
  list: () => [...professionalKeys.lists(), 'all'] as const,
  pages: (query: ProfessionalsPageQuery) => [...professionalKeys.lists(), 'pages', query] as const,
  record: (id: string) => [...professionalKeys.all, 'record', id] as const,
  history: (id: string) => [...professionalKeys.all, 'history', id] as const,
}

/** The nine lists (one cached payload) and their usage counts. */
export const professionalCatalogKeys = {
  all: ['professionals-catalog'] as const,
  catalog: () => [...professionalCatalogKeys.all, 'catalog'] as const,
  usage: () => [...professionalCatalogKeys.all, 'usage'] as const,
}

export const professionalsSettingsKeys = {
  all: ['professionals-settings'] as const,
  settings: () => [...professionalsSettingsKeys.all, 'settings'] as const,
}
