import type { ModuleSearchFn, ModuleSearchResult } from '@/core/modules/types'
import { searchProfessionalsRows, type ProfessionalSearchRow } from './api/search'
import { recordPath } from './lib/constants'
import { fullName, statusLabel, statusTone } from './lib/display'

/**
 * The professionals' group in the global search (⌘K). Loaded by the manifest's `search[].load`
 * (its own chunk, only once the palette searches): the shell never imports the module.
 */

/** A row as the palette shows it: the name, « Psychologue · OPQ 12345 », the list's status wording. */
export function toSearchResult(row: ProfessionalSearchRow): ModuleSearchResult {
  const licence = [row.orderAcronym, row.licenceNumber].filter(Boolean).join(' ')
  const subtitle = [row.titleLabel, licence].filter(Boolean).join(' · ')
  return {
    id: row.id,
    title: fullName(row),
    ...(subtitle && { subtitle }),
    href: recordPath(row.id),
    badge: { label: statusLabel(row.displayStatus), tone: statusTone(row.displayStatus) },
  }
}

export const searchProfessionals: ModuleSearchFn = async (query, signal) =>
  (await searchProfessionalsRows(query, signal)).map(toSearchResult)
