import type { MatchStatus } from '../api/quickbooks'

/**
 * React Query keys of QuickBooks (FQ):
 *
 * | Change                                              | Invalidated                          |
 * |-----------------------------------------------------|--------------------------------------|
 * | connected, synchronised, disconnected               | `all` (the settings, the report)     |
 * | an account chosen for a map row                     | `settings()`                         |
 * | a customer linked, ignored or reset in the report   | `matches()` (the lists and counts)   |
 */
export const qboKeys = {
  all: ['billing', 'qbo'] as const,
  settings: () => [...qboKeys.all, 'settings'] as const,
  matches: () => [...qboKeys.all, 'matches'] as const,
  counts: () => [...qboKeys.matches(), 'counts'] as const,
  list: (status: MatchStatus, search: string, page: number) => [...qboKeys.matches(), 'list', status, search.trim(), page] as const,
}
