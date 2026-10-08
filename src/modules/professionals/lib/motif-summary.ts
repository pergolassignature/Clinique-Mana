import type { CatalogView } from './catalog-view'

/**
 * A professional's motifs in a few lines (P4-73): some hold nearly all 72, and a run of 72 names
 * cannot be scanned. A category with up to FEW motifs held shows their names (so a category of
 * two, both held, reads its two names, not « Tous »); else it reads « Tous (9) », « Tous sauf … »
 * (≤ FEW missing) or « N sur M ». When more than FEW motifs and nearly every one is held, one line
 * says so for the whole list. Every summarised line is always
 * expandable to the names it stands for (Jonathan, 2026-10-08): the summary never hides a name
 * for good.
 */

/** A category names up to this many motifs, or this many exceptions (« Tous sauf … »). */
export const FEW_MOTIFS = 3
/** The whole list reads « Tous sauf … » with up to this many exceptions. */
export const FEW_EXCEPTIONS = 5

/** Each kind carries `names`, the active motifs held in the category: what a summarised line unfolds to. */
export type MotifGroupSummary =
  | { kind: 'names'; names: string[] }
  | { kind: 'all'; names: string[] }
  | { kind: 'allBut'; missing: string[]; names: string[] }
  | { kind: 'count'; selected: number; total: number; names: string[] }

export interface MotifSummaryGroup {
  key: string
  name: string
  summary: MotifGroupSummary
}

export interface HeldMotif {
  name: string
  archived: boolean
}

export interface MotifSummary {
  /** Active motifs held, out of the clinic's active motifs (archived ones count in neither). */
  selected: number
  total: number
  /** One line for the whole list, when every motif or all but a few are held; it unfolds to `full`. */
  overall: { kind: 'all' } | { kind: 'allBut'; missing: string[] } | null
  /** Categories holding an active motif, in the catalogue's order, « Autres » last. */
  groups: MotifSummaryGroup[]
  /** Held motifs the clinic has archived (matching ignores them), by name. */
  archived: string[]
  /** Every held motif by category, archived ones last and marked: what the overall line unfolds to. */
  full: { key: string; name: string; motifs: HeldMotif[] }[]
}

function groupSummary(held: string[], missing: string[]): MotifGroupSummary {
  const total = held.length + missing.length
  // Few held: the names, even when they are the whole (small) category: « Tous » would hide two words.
  if (held.length <= FEW_MOTIFS) return { kind: 'names', names: held }
  if (missing.length === 0) return { kind: 'all', names: held }
  if (missing.length <= FEW_MOTIFS) return { kind: 'allBut', missing, names: held }
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
    if (heldActive.length + heldArchived.length > 0) {
      const motifs = [...heldActive.map((name) => ({ name, archived: false })), ...heldArchived.map((name) => ({ name, archived: true }))]
      full.push({ key: group.key, name: group.name, motifs })
    }
  }
  // Up to FEW held, every category line shows its names already: no overall line to unfold.
  const overall: MotifSummary['overall'] =
    selected <= FEW_MOTIFS
      ? null
      : selected === total
        ? { kind: 'all' }
        : missingOverall.length <= FEW_EXCEPTIONS && selected > missingOverall.length
          ? { kind: 'allBut', missing: missingOverall }
          : null
  return { selected, total, overall, groups, archived, full }
}
