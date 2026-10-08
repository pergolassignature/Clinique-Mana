import type { Clientele, ProfessionalRecord, SpecializedRef } from '../api/parse'
import type { CatalogView } from './catalog-view'
import { clienteleLabel, minAgeClienteleLabel, periodsLabel } from './display'
import { summarizeMotifs, type MotifSummary } from './motif-summary'

/** One held item, named from the catalogue. Archived items stay listed (readiness ignores them). */
export interface DigestItem {
  id: string
  label: string
  /** The « spécialisé » star (clientèles only). */
  specialized: boolean
  archived: boolean
}

/** Aperçu « Profil de jumelage »: what matching reads, in words. */
export interface MatchingDigest {
  /** The youngest held age group reads the professional's youngest client age: « Enfants (8 ans et plus) » (P4-245). */
  clienteles: DigestItem[]
  /** The youngest client age when no held age group can carry it (« Âge minimum : 14 ans »), else null. */
  minClientAge: number | null
  /** « Femmes seulement » (P4-245). */
  womenOnly: boolean
  /** By category, every held motif named (P4-249). */
  motifs: MotifSummary
  languages: DigestItem[]
  /** « Matin · Soir », empty without a period. */
  periods: string
  acceptingNewClients: boolean
  note: string | null
}

interface Row {
  id: string
  name: string
  isActive: boolean
}

/** The held rows in the catalogue's order; unknown ids (a catalogue older than the record) are skipped. */
export function held<T extends Row>(rows: readonly T[], specialized: ReadonlyMap<string, boolean>, label: (row: T) => string = (row) => row.name): DigestItem[] {
  return rows
    .filter((row) => specialized.has(row.id))
    .map((row) => ({ id: row.id, label: label(row), specialized: specialized.get(row.id) === true, archived: !row.isActive }))
}

/** ★ first (a stable sort keeps the catalogue order within each half), as the legacy pickers did. */
export function starredFirst<T extends Row>(rows: readonly T[], refs: readonly SpecializedRef[], label?: (row: T) => string): DigestItem[] {
  return held(rows, new Map(refs.map((r) => [r.id, r.specialized])), label).sort((a, b) => Number(b.specialized) - Number(a.specialized))
}

const unstarred = (ids: readonly string[]) => new Map(ids.map((id) => [id, false]))

/**
 * The held age group the youngest client age qualifies: the held age group with the lowest
 * minimum, when the professional's youngest client age is above it (« Enfants » 0–12 held, 8 → «
 * Enfants (8 ans et plus) »). Null when no age group is held, or the age adds nothing.
 */
function youngestQualified(record: ProfessionalRecord, catalog: CatalogView): string | null {
  const { minClientAge } = record.matchingProfile
  if (minClientAge === null) return null
  const held = new Set(record.clienteles.map((c) => c.id))
  const ageGroups = catalog.clienteles.filter((c): c is Clientele & { minAge: number } => held.has(c.id) && c.minAge !== null)
  const youngest = ageGroups.reduce<(typeof ageGroups)[number] | null>((low, c) => (low === null || c.minAge < low.minAge ? c : low), null)
  return youngest && minClientAge > youngest.minAge ? youngest.id : null
}

export function matchingDigest(record: ProfessionalRecord, catalog: CatalogView): MatchingDigest {
  const note = record.matchingProfile.availabilityNote?.trim()
  const { minClientAge, womenOnly } = record.matchingProfile
  const qualified = youngestQualified(record, catalog)
  const label = (c: Clientele) =>
    c.id === qualified && minClientAge !== null ? minAgeClienteleLabel(c.name, minClientAge) : clienteleLabel(c)
  const heldAgeGroup = catalog.clienteles.some((c) => c.minAge !== null && record.clienteles.some((r) => r.id === c.id))
  return {
    clienteles: starredFirst(catalog.clienteles, record.clienteles, label),
    // Carried by the age group when one is held (even when it adds nothing: « Adolescents » from 13, 13).
    minClientAge: heldAgeGroup ? null : minClientAge,
    womenOnly,
    motifs: summarizeMotifs(record.motifIds, catalog),
    languages: held(catalog.languages, unstarred(record.languageIds)),
    periods: periodsLabel(record.matchingProfile.availabilityPeriods),
    acceptingNewClients: record.matchingProfile.acceptingNewClients,
    note: note ? note : null,
  }
}
