import type { CatalogueMotif, MyDemande } from '../api/mine'

export interface MotifGroup {
  /** The category's name; null for the motifs without one (listed last). */
  category: string | null
  names: string[]
}

/**
 * A request's motifs written out by name, by category (Jonathan's motif rules, P4-249): the
 * categories in the catalogue's order, « Sans catégorie » last, the names in order. A motif no
 * longer in the catalogue (retired) has no name to show and is left out.
 */
export function motifGroups(ids: readonly string[], motifs: readonly CatalogueMotif[]): MotifGroup[] {
  const held = motifs
    .filter((m) => ids.includes(m.id))
    .sort(
      (a, b) =>
        Number(a.category_name === null) - Number(b.category_name === null) ||
        (a.category_sort_order ?? 0) - (b.category_sort_order ?? 0) ||
        (a.category_name ?? '').localeCompare(b.category_name ?? '', 'fr-CA') ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.name.localeCompare(b.name, 'fr-CA'),
    )
  const groups: MotifGroup[] = []
  for (const m of held) {
    const last = groups.at(-1)
    if (last && last.category === m.category_name) last.names.push(m.name)
    else groups.push({ category: m.category_name, names: [m.name] })
  }
  return groups
}

/** Who the request is for: the main participant's name, else the first one's; null without any. */
export function mainPerson(demande: Pick<MyDemande, 'participants'>): string | null {
  const main = demande.participants.find((p) => p.is_primary) ?? demande.participants[0]
  return main?.display_name?.trim() || null
}
