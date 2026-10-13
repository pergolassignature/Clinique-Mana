import { t } from '@/i18n'
import { formatPhone } from '@/shared/lib/format'
import { getClinicDateString } from '@/shared/lib/timezone'
import type { ClientLanguage, ClientRateVariant, HolderRelation, PayerKind, RelationRight, RelationType, Sex } from './constants'

/** The module's words for its stored codes (the same ones the Journal d'audit reads). */
const A = 'modules.clients.audit.values'

export const sexLabel = (sex: Sex): string => t(`${A}.clients.sex.${sex}`)
export const languageLabel = (language: ClientLanguage): string => t(`${A}.clients.language.${language}`)
export const rateVariantLabel = (variant: ClientRateVariant): string => t(`${A}.clients.rate_variant.${variant}`)
export const relationTypeLabel = (type: RelationType): string => t(`${A}.client_relations.type_a_to_b.${type}`)
export const payerKindLabel = (kind: PayerKind): string => t(`${A}.client_payers.kind.${kind}`)
export const holderRelationLabel = (relation: HolderRelation): string => t(`${A}.client_insurances.holder_relation.${relation}`)
export const rightLabel = (right: RelationRight): string => t(`modules.clients.rights.${right}`)

/**
 * The choices of a reference list: the active rows, plus the ones a file already holds (an inactive
 * professional, source or tag stays shown, « (inactif) », so a save never hides or drops it).
 */
export function choices(options: readonly { id: string; name: string; active: boolean }[] | undefined, held: readonly (string | null)[] = []) {
  return (options ?? [])
    .filter((o) => o.active || held.includes(o.id))
    .map((o) => ({ value: o.id, label: o.active ? o.name : t('modules.clients.fields.inactive', { name: o.name }) }))
}

/** « CLI-000123 »: the file number as the clinic quotes it. */
export const clientNumberLabel = (number: number): string => `CLI-${String(number).padStart(6, '0')}`

/** « Alice Tremblay ». */
export const fullName = (client: { firstName: string; lastName: string }): string => `${client.firstName} ${client.lastName}`

/** The age in whole years on the clinic's today, from a date-only birthday; null without one. */
export function ageOf(birthday: string | null, today: string = getClinicDateString(new Date())): number | null {
  if (!birthday) return null
  const [by, bm, bd] = birthday.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  if (!by || !bm || !bd || !ty || !tm || !td) return null
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age -= 1
  return age
}

/** « 514 555-0101 », or the stored value when it is not North American. */
export const phoneLabel = (e164: string | null): string => formatPhone(e164)

/** « 94,50 $ » from cents. */
const money = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const centsLabel = (cents: number): string => `${money.format(cents / 100)}\u00A0$`
