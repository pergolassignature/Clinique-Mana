/**
 * The Clients list's optional columns (A-3, CL-32): the name always shows; these the person turns
 * on or off (« Colonnes »), remembered for her on any computer (user preference
 * `clients.list_columns`, `{ columns: [...] }`; never browser storage, decision #10). « Dernier
 * rendez-vous » shows only with the agenda's right and Rendez-vous on, whatever she chose.
 */
export const CLIENT_LIST_COLUMNS = ['number', 'birthday', 'contact', 'professional', 'lastVisit', 'opened', 'flags'] as const
export type ClientListColumn = (typeof CLIENT_LIST_COLUMNS)[number]
export const DEFAULT_CLIENT_LIST_COLUMNS: readonly ClientListColumn[] = ['number', 'birthday', 'contact', 'professional', 'lastVisit', 'flags']
export const CLIENT_LIST_COLUMNS_PREFERENCE = 'clients.list_columns'

/** The columns a stored preference names, in the list's order (unknown ones dropped; none stored: the defaults). */
export function listColumnsOf(value: unknown): ClientListColumn[] {
  const stored = value && typeof value === 'object' && Array.isArray((value as { columns?: unknown }).columns) ? (value as { columns: unknown[] }).columns : null
  if (!stored) return [...DEFAULT_CLIENT_LIST_COLUMNS]
  return CLIENT_LIST_COLUMNS.filter((c) => stored.includes(c))
}
