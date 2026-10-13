import type { ModuleSearchFn, ModuleSearchResult } from '@/core/modules/types'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { t } from '@/i18n'
import { searchClients } from './api/clients'
import type { ClientSearchRow } from './api/parse'
import { clientPath } from './lib/constants'
import { clientNumberLabel } from './lib/display'

/**
 * The clients' group in the global search (⌘K, plan C4): `search_clients` (every word in the name,
 * accents ignored, the email, the number or a phone's digits; never merged or anonymised files).
 * Loaded by the manifest's `search[].load`, its own chunk, only once the palette searches.
 */

/** A row as the palette shows it: the name, « CLI-000123 · 4 mars 1990 », « Archivé » when it is. */
export function toSearchResult(row: ClientSearchRow): ModuleSearchResult {
  const subtitle = [clientNumberLabel(row.clientNumber), row.birthday && formatDateOnlyShort(row.birthday)].filter(Boolean).join(' · ')
  return {
    id: row.id,
    title: row.name,
    subtitle,
    href: clientPath(row.id),
    ...(row.isArchived && { badge: { label: t('modules.clients.record.archived'), tone: 'secondary' as const } }),
  }
}

export const searchClientFiles: ModuleSearchFn = async (query, signal) => (await searchClients(query, signal)).map(toSearchResult)
