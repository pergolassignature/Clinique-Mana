import type { CatalogView } from './catalog-view'
import type { MotifCategoryIcon } from './constants'

/**
 * A professional's motifs, by category, always by name (P4-73 as revised by P4-249, Jonathan,
 * 2026-10-08): every category holding a motif is listed in the catalogue's order with every held
 * motif named, never « Tous », « Tous sauf … » or « N sur M » in their place. The « 9 / 16 » count
 * is only shown beside the category's name, in addition to the names.
 */

/** A count sentence names up to this many items (Historique: « a ajouté les motifs A, B et C »). */
export const FEW_MOTIFS = 3

export interface HeldMotif {
  id: string
  name: string
  archived: boolean
}

/** A category holding at least one motif (active or archived). */
export interface MotifSummaryGroup {
  key: string
  name: string
  icon: MotifCategoryIcon | null
  /** Active motifs held, out of the category's active motifs. */
  selected: number
  total: number
  /** Its held motifs in the catalogue's order, the archived ones last and marked. */
  motifs: HeldMotif[]
}

export interface MotifSummary {
  /** Active motifs held, out of the clinic's active motifs (archived ones count in neither). */
  selected: number
  total: number
  /** Categories holding a motif, in the catalogue's order, « Sans catégorie » last. */
  groups: MotifSummaryGroup[]
  /** Held motifs the clinic has archived (matching ignores them), by name. */
  archived: string[]
}

export function summarizeMotifs(motifIds: readonly string[], catalog: CatalogView): MotifSummary {
  const held = new Set(motifIds)
  const groups: MotifSummaryGroup[] = []
  const archived: string[] = []
  let selected = 0
  let total = 0
  for (const group of catalog.motifGroups) {
    const active = group.motifs.filter((m) => m.isActive)
    const heldActive = active.filter((m) => held.has(m.id))
    const heldArchived = group.motifs.filter((m) => !m.isActive && held.has(m.id))
    selected += heldActive.length
    total += active.length
    archived.push(...heldArchived.map((m) => m.name))
    if (heldActive.length + heldArchived.length === 0) continue
    groups.push({
      key: group.key,
      name: group.name,
      icon: group.icon,
      selected: heldActive.length,
      total: active.length,
      motifs: [...heldActive, ...heldArchived].map(({ id, name, isActive }) => ({ id, name, archived: !isActive })),
    })
  }
  return { selected, total, groups, archived }
}
