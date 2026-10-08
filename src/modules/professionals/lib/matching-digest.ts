import type { ProfessionalRecord, SpecializedRef } from '../api/parse'
import type { CatalogView } from './catalog-view'
import { clienteleLabel, periodsLabel } from './display'
import { summarizeMotifs, type MotifSummary } from './motif-summary'

/** One held item, named from the catalogue. Archived items stay listed (readiness ignores them). */
export interface DigestItem {
  id: string
  label: string
  /** The « spécialisé » star (clientèles and approaches only). */
  specialized: boolean
  archived: boolean
}

/** Aperçu « Profil de jumelage »: what matching reads, in words. */
export interface MatchingDigest {
  clienteles: DigestItem[]
  approaches: DigestItem[]
  /** Summarised by category, so 72 held motifs still read in a few lines (P4-73). */
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
function held<T extends Row>(rows: readonly T[], specialized: ReadonlyMap<string, boolean>, label: (row: T) => string = (row) => row.name): DigestItem[] {
  return rows
    .filter((row) => specialized.has(row.id))
    .map((row) => ({ id: row.id, label: label(row), specialized: specialized.get(row.id) === true, archived: !row.isActive }))
}

/** ★ first (a stable sort keeps the catalogue order within each half), as the legacy pickers did. */
function starredFirst<T extends Row>(rows: readonly T[], refs: readonly SpecializedRef[], label?: (row: T) => string): DigestItem[] {
  return held(rows, new Map(refs.map((r) => [r.id, r.specialized])), label).sort((a, b) => Number(b.specialized) - Number(a.specialized))
}

const unstarred = (ids: readonly string[]) => new Map(ids.map((id) => [id, false]))

export function matchingDigest(record: ProfessionalRecord, catalog: CatalogView): MatchingDigest {
  const note = record.matchingProfile.availabilityNote?.trim()
  return {
    clienteles: starredFirst(catalog.clienteles, record.clienteles, clienteleLabel),
    approaches: starredFirst(catalog.specialties, record.specialties),
    motifs: summarizeMotifs(record.motifIds, catalog),
    languages: held(catalog.languages, unstarred(record.languageIds)),
    periods: periodsLabel(record.matchingProfile.availabilityPeriods),
    acceptingNewClients: record.matchingProfile.acceptingNewClients,
    note: note ? note : null,
  }
}
