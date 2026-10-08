import type { CatalogView } from './catalog-view'

/**
 * A professional's motifs in a few lines (P4-73): some hold nearly all 72, and a run of 72 names
 * cannot be scanned. Each category reads « Tous », its names (≤ FEW), « Tous sauf … » (≤ FEW
 * missing) or « N sur M » (names behind a disclosure); when nearly every motif is held, one line
 * says so for the whole list. The full list is shown on demand only.
 */

/** A category names up to this many motifs, or this many exceptions (« Tous sauf … »). */
export const FEW_MOTIFS = 3
/** The whole list reads « Tous sauf … » with up to this many exceptions. */
export const FEW_EXCEPTIONS = 5

export type MotifGroupSummary =
  | { kind: 'all' }
  | { kind: 'names'; names: string[] }
  | { kind: 'allBut'; missing: string[] }
  | { kind: 'count'; selected: number; total: number; names: string[] }

export interface MotifSummaryGroup {
  key: string
  name: string
  summary: MotifGroupSummary
}

export interface MotifSummary {
  /** Active motifs held, out of the clinic's active motifs (archived ones count in neither). */
  selected: number
  total: number
  /** One line for the whole list, when every motif or all but a few are held. */
  overall: { kind: 'all' } | { kind: 'allBut'; missing: string[] } | null
  /** Categories holding an active motif, in the catalogue's order, « Autres » last. */
  groups: MotifSummaryGroup[]
  /** Held motifs the clinic has archived (matching ignores them), by name. */
  archived: string[]
  /** Every held motif by category, archived ones included: the list shown on demand. */
  full: { key: string; name: string; names: string[] }[]
  /** Whether the summary hides names, so « Voir les N motifs » has something to show. */
  condensed: boolean
}

function groupSummary(held: string[], missing: string[]): MotifGroupSummary {
  const total = held.length + missing.length
  if (missing.length === 0) return { kind: 'all' }
  if (held.length <= FEW_MOTIFS) return { kind: 'names', names: held }
  if (missing.length <= FEW_MOTIFS) return { kind: 'allBut', missing }
  return { kind: 'count', selected: held.length, total, names: held }
}

export function summarizeMotifs(motifIds: readonly string[], catalog: CatalogView): MotifSummary {
  const held = new Set(motifIds)
  const groups: MotifSummaryGroup[] = []
  const full: MotifSummary['full'] = []
  const archived: string[] = []
  const missingOverall: string[] = []
  let selected = 0
  let total = 0
  for (const group of catalog.motifGroups) {
    const active = group.motifs.filter((m) => m.isActive)
    const heldActive = active.filter((m) => held.has(m.id)).map((m) => m.name)
    const missing = active.filter((m) => !held.has(m.id)).map((m) => m.name)
    const heldArchived = group.motifs.filter((m) => !m.isActive && held.has(m.id)).map((m) => m.name)
    selected += heldActive.length
    total += active.length
    missingOverall.push(...missing)
    archived.push(...heldArchived)
    if (heldActive.length > 0) groups.push({ key: group.key, name: group.name, summary: groupSummary(heldActive, missing) })
    if (heldActive.length + heldArchived.length > 0) full.push({ key: group.key, name: group.name, names: [...heldActive, ...heldArchived] })
  }
  const overall: MotifSummary['overall'] =
    total > 0 && selected === total
      ? { kind: 'all' }
      : missingOverall.length <= FEW_EXCEPTIONS && selected > missingOverall.length
        ? { kind: 'allBut', missing: missingOverall }
        : null
  return { selected, total, overall, groups, archived, full, condensed: overall !== null || groups.some((g) => g.summary.kind !== 'names') }
}
