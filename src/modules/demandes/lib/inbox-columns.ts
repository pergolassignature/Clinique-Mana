/**
 * The inbox's optional columns (D-47): the person and « Reçue » always show; these the
 * conseillère turns on or off (« Colonnes »), remembered for her (user preference
 * `demandes.inbox_columns`, `{ columns: [...] }`).
 */
export const INBOX_COLUMNS = ['state', 'assigned', 'followUp', 'beneficiary', 'motifs'] as const
export type InboxColumn = (typeof INBOX_COLUMNS)[number]
export const DEFAULT_INBOX_COLUMNS: readonly InboxColumn[] = ['state', 'assigned', 'followUp']
export const INBOX_COLUMNS_PREFERENCE = 'demandes.inbox_columns'

/** The columns a stored preference names (unknown ones dropped; none stored: the defaults). */
export function columnsOf(value: unknown): InboxColumn[] {
  const stored = value && typeof value === 'object' && Array.isArray((value as { columns?: unknown }).columns) ? (value as { columns: unknown[] }).columns : null
  if (!stored) return [...DEFAULT_INBOX_COLUMNS]
  return INBOX_COLUMNS.filter((c) => stored.includes(c))
}

/** The inbox's sorts as the URL says them (`?tri=`); the default (`priority`) has none. */
export const SORT_PARAM = { priority: null, received_desc: 'recentes', received_asc: 'anciennes', waiting_desc: 'attente', state: 'etat' } as const
