import { t } from '@/i18n'
import { AVAILABILITY_PERIODS, type AvailabilityPeriod, type Gender, type ProfessionalStatus } from './constants'
import { titleOrder, type CatalogView } from './catalog-view'
import type { ProfessionalRecord, ProfessionRow } from '../api/parse'

/** Joins short labels on one line: « FR · EN », « Psychologue · OPQ 12345 ». */
const SEPARATOR = ' · '

export function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`
}

/** « À inviter », « Invité », « À réviser », « Actif », « Inactif ». */
export function statusLabel(status: ProfessionalStatus): string {
  return t(`modules.professionals.status.${status}`)
}

export function genderLabel(gender: Gender): string {
  return t(`modules.professionals.gender.${gender}`)
}

/** A clientèle's age bounds: `minAge` null = not an age group (couples…); `maxAge` null = « et plus ». */
interface AgeBounds {
  minAge: number | null
  maxAge: number | null
}

/** « an » under 2, « ans » from 2 (French: « 1 an », « 0 à 1 an », « 2 ans »). */
const years = (age: number) => t(age < 2 ? 'modules.professionals.display.ages.year' : 'modules.professionals.display.ages.years')

/**
 * A clientèle's ages in words: « 6 à 12 ans », « 12 ans », « 18 ans et plus », « Tous les âges »
 * (from 0, no maximum), « Sans limite d'âge » (not an age group: couples, families, groups).
 */
export function agesLabel({ minAge, maxAge }: AgeBounds): string {
  const A = 'modules.professionals.display.ages'
  if (minAge === null) return t(`${A}.none`)
  if (maxAge === null) return minAge === 0 ? t(`${A}.all`) : t(`${A}.from`, { min: String(minAge), unit: years(minAge) })
  if (maxAge === minAge) return t(`${A}.single`, { age: String(minAge), unit: years(minAge) })
  return t(`${A}.range`, { min: String(minAge), max: String(maxAge), unit: years(maxAge) })
}

/** « Enfants (0 à 12 ans) », « Aînés (65 ans et plus) », « Couples » (not an age group: the name alone). */
export function clienteleLabel(c: { name: string } & AgeBounds): string {
  if (c.minAge === null) return c.name
  return t('modules.professionals.display.withAges', { name: c.name, ages: agesLabel(c) })
}

/** « FR · EN »: the codes of the held languages, in the catalogue's order. Unknown ids are skipped. */
export function languagesLabel(languageIds: readonly string[], catalog: CatalogView): string {
  const held = new Set(languageIds)
  return catalog.languages
    .filter((l) => held.has(l.id))
    .map((l) => l.code.toUpperCase())
    .join(SEPARATOR)
}

/** « Matin · Soir », in the fixed period order. */
export function periodsLabel(periods: readonly AvailabilityPeriod[]): string {
  return AVAILABILITY_PERIODS.filter((p) => periods.includes(p))
    .map((p) => t(`modules.professionals.periods.${p}`))
    .join(SEPARATOR)
}

/**
 * « Psychologue · OPQ 12345 »: the title, then the order's acronym and the licence. Empty without
 * a title, or for a title the catalogue does not know.
 */
export function professionLine(row: Pick<ProfessionRow, 'titleId' | 'licenceNumber'> | null, catalog: CatalogView): string {
  const title = row ? catalog.byId.titles.get(row.titleId) : undefined
  if (!row || !title) return ''
  const licence = [titleOrder(catalog, row.titleId)?.acronym, row.licenceNumber].filter(Boolean).join(' ')
  return licence ? `${title.name}${SEPARATOR}${licence}` : title.name
}

/** The record's primary title, or null without one. */
export function primaryProfession(record: Pick<ProfessionalRecord, 'professions'>): ProfessionRow | null {
  return record.professions.find((p) => p.isPrimary) ?? null
}
