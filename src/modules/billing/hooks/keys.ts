import type { MatchStatus } from '../api/quickbooks'

/**
 * Facturation's query keys. Every write invalidates `all` (an invoice, its dossier's panel and the
 * lists move together; one clinic's invoices are few at a time).
 */
export const billingKeys = {
  all: ['billing'] as const,
  invoices: (status: string | null) => [...billingKeys.all, 'invoices', status] as const,
  invoice: (id: string) => [...billingKeys.all, 'invoice', id] as const,
  client: (clientId: string) => [...billingKeys.all, 'client', clientId] as const,
  names: () => [...billingKeys.all, 'names'] as const,
  sequence: (year: number) => [...billingKeys.all, 'sequence', year] as const,
  queue: () => [...billingKeys.all, 'queue'] as const,
  overdue: () => [...billingKeys.all, 'overdue'] as const,
  fees: (status: string | null) => [...billingKeys.all, 'fees', status] as const,
  settings: () => [...billingKeys.all, 'settings'] as const,
}

/**
 * React Query keys of QuickBooks (FQ):
 *
 * | Change                                              | Invalidated                          |
 * |-----------------------------------------------------|--------------------------------------|
 * | connected, synchronised, disconnected               | `all` (the settings, the report)     |
 * | an account chosen for a map row                     | `settings()`                         |
 * | a customer linked, ignored or reset in the report   | `matches()` (the lists and counts)   |
 * | the push paused or started, a push retried          | `settings()`, `pushes()`             |
 */
export const qboKeys = {
  all: ['billing', 'qbo'] as const,
  settings: () => [...qboKeys.all, 'settings'] as const,
  matches: () => [...qboKeys.all, 'matches'] as const,
  counts: () => [...qboKeys.matches(), 'counts'] as const,
  list: (status: MatchStatus, search: string, page: number) => [...qboKeys.matches(), 'list', status, search.trim(), page] as const,
  /** The push (FQ part 2): its list, an invoice's state. */
  pushes: () => [...qboKeys.all, 'pushes'] as const,
  pushList: (status: string | null) => [...qboKeys.pushes(), 'list', status] as const,
  invoicePush: (invoiceId: string) => [...qboKeys.pushes(), 'invoice', invoiceId] as const,
}
