import type { ProfessionalRecord, ProfessionRow } from '../api/parse'
import type { CatalogView } from './catalog-view'

/**
 * What the « Fiche PDF » menu needs before any PDF code loads (Task 4c.5): the titles a fiche can
 * be made for and its file name. The renderer itself (`../pdf/`) loads only on demand.
 */

/** A title the fiche can carry (A2.19: one fiche per profession title). */
export interface FicheTitle {
  titleId: string
  name: string
}

/**
 * The professional's titles, the primary one first, named from the catalogue (an archived title
 * is still theirs). Empty without a title: the fiche then shows the name alone.
 */
export function ficheTitles(record: Pick<ProfessionalRecord, 'professions'>, catalog: CatalogView): FicheTitle[] {
  return [...record.professions]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .flatMap((row) => {
      const title = catalog.byId.titles.get(row.titleId)
      return title ? [{ titleId: row.titleId, name: title.name }] : []
    })
}

/**
 * The title row a fiche is for: the chosen one, else the primary one, else the first; null
 * without a title. The content prints it and the public fees are read for it (P4-218).
 */
export function ficheProfession(record: Pick<ProfessionalRecord, 'professions'>, titleId: string | null): ProfessionRow | null {
  return record.professions.find((p) => p.titleId === titleId) ?? record.professions.find((p) => p.isPrimary) ?? record.professions[0] ?? null
}

/** The longest name the email path attaches (`SAFE_FILENAME` in `_shared/email/send.ts`): 100 characters with « .pdf ». */
const MAX_FILE_NAME = 100
/** Anything but letters, digits, spaces and `'’()._-`: the characters an attachment's name may hold. */
const UNSAFE = /[^\p{L}\p{N} '’()._-]+/gu

/**
 * « Fiche - Prénom Nom.pdf » (P4-200): letters of every language kept, any other character a
 * space, spaces collapsed, cut to 100 characters with the extension. The function names the
 * emailed attachment by the same rule (`ficheFileName` in `supabase/functions/professionals-fiche/`,
 * parity in `fiche.test.ts`).
 */
export function ficheFileName(person: { firstName: string; lastName: string }): string {
  const name = `${person.firstName} ${person.lastName}`.normalize('NFC').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  const base = name ? `Fiche - ${name}` : 'Fiche'
  return `${Array.from(base).slice(0, MAX_FILE_NAME - 4).join('').trimEnd()}.pdf`
}
