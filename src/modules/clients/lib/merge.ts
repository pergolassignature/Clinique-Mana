import { t, type TranslationKey } from '@/i18n'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import type { ClientsReference } from '../api/clients'
import type { Client, ClientSummary } from '../api/parse'
import { languageLabel, phoneLabel, rateVariantLabel, sexLabel } from './display'

/**
 * The merge screen's comparison (plan C4.1, CL-24), pure. Each row is one value of the file, or
 * the address as a block (`merge_clients` fills an address only as a whole):
 * - both files hold a value and they differ: a choice, the kept file's value first;
 * - only the merged file holds one: it is taken (the database fills the kept file's empty fields);
 * - otherwise the row is left out.
 * The rows whose merged value is taken are sent as `merge_clients`' `take` keys: the database
 * copies the values from the merged file itself (the screen never sends a value). The address is
 * always sent when taken: the database fills only a file with no address at all, and a file
 * created here holds a province (« QC ») without one.
 */

export interface MergeRow {
  key: string
  labelKey: TranslationKey
  kept: string | null
  merged: string | null
  /** `merge_clients`' key for this row (`private.clients_merge_take_columns`). */
  take: string
  /** true: both hold a value and they differ; false: the kept file has none, the merged one's is taken. */
  choice: boolean
}

type Field = {
  key: string
  labelKey: TranslationKey
  take: string
  /** The value as shown, or null when the file has none. */
  show: (client: Client, reference: ClientsReference | undefined) => string | null
  /** What is compared, when the shown text is not the value (an id shown as a name). */
  raw?: (client: Client) => string | null
}

const F = 'modules.clients.fields'
const nameOf = (options: readonly { id: string; name: string }[] | undefined, id: string | null) =>
  id === null ? null : (options?.find((o) => o.id === id)?.name ?? t('modules.clients.merge.unknownValue'))

const FIELDS: readonly Field[] = [
  { key: 'firstName', labelKey: `${F}.firstName`, take: 'first_name', show: (c) => c.firstName },
  { key: 'lastName', labelKey: `${F}.lastName`, take: 'last_name', show: (c) => c.lastName },
  { key: 'birthFirstName', labelKey: `${F}.birthFirstName`, take: 'birth_first_name', show: (c) => c.birthFirstName },
  { key: 'pronouns', labelKey: `${F}.pronouns`, take: 'pronouns', show: (c) => c.pronouns },
  { key: 'sex', labelKey: `${F}.sex`, take: 'sex', show: (c) => c.sex && sexLabel(c.sex) },
  { key: 'birthday', labelKey: `${F}.birthday`, take: 'birthday', show: (c) => c.birthday && formatDateOnlyShort(c.birthday) },
  { key: 'language', labelKey: `${F}.language`, take: 'language', show: (c) => languageLabel(c.language) },
  { key: 'email', labelKey: `${F}.email`, take: 'email', show: (c) => c.email },
  { key: 'mobile', labelKey: `${F}.mobile`, take: 'mobile', show: (c) => c.mobile && phoneLabel(c.mobile) },
  { key: 'home', labelKey: `${F}.home`, take: 'home', show: (c) => c.home && phoneLabel(c.home) },
  {
    key: 'work',
    labelKey: `${F}.work`,
    take: 'work',
    show: (c) => c.work && [phoneLabel(c.work), c.workExt && t('modules.clients.merge.ext', { ext: c.workExt })].filter(Boolean).join(' '),
  },
  {
    key: 'address',
    labelKey: 'modules.clients.merge.address',
    take: 'address',
    show: (c) =>
      c.addressLine1 || c.city || c.postalCode ? [c.addressLine1, c.addressLine2, c.city, c.province, c.postalCode].filter(Boolean).join(', ') : null,
  },
  { key: 'referralSourceId', labelKey: `${F}.referralSource`, take: 'referral_source_id', show: (c, r) => nameOf(r?.referralSources, c.referralSourceId), raw: (c) => c.referralSourceId },
  { key: 'referredBy', labelKey: `${F}.referredBy`, take: 'referred_by', show: (c) => c.referredBy ?? (c.referredByClientId ? t('modules.clients.referrer.linked') : null) },
  {
    key: 'primaryProfessionalId',
    labelKey: `${F}.primaryProfessional`,
    take: 'primary_professional_id',
    show: (c, r) => nameOf(r?.professionals, c.primaryProfessionalId),
    raw: (c) => c.primaryProfessionalId,
  },
  { key: 'rateVariant', labelKey: `${F}.rateVariant`, take: 'rate_variant', show: (c) => c.rateVariant && rateVariantLabel(c.rateVariant) },
]

/** The rows to show for keeping `kept` and merging `merged` into it. */
export function mergeRows(kept: Client, merged: Client, reference?: ClientsReference): MergeRow[] {
  return FIELDS.flatMap((field) => {
    const keptValue = field.show(kept, reference)
    const mergedValue = field.show(merged, reference)
    if (!mergedValue) return []
    const same = field.raw ? field.raw(kept) === field.raw(merged) : keptValue === mergedValue
    if (keptValue && same) return []
    return [{ key: field.key, labelKey: field.labelKey, kept: keptValue || null, merged: mergedValue, take: field.take, choice: Boolean(keptValue) }]
  })
}

/** `merge_clients`' `take`: the rows where the person took the merged value, and the address when only the merged file has one. */
export function chosenTakes(rows: readonly MergeRow[], takeMerged: ReadonlySet<string>): string[] {
  return rows.filter((row) => (row.choice ? takeMerged.has(row.key) : row.key === 'address')).map((row) => row.take)
}

/** What moves with the merged file, for the confirmation (counts from its summary). */
export function mergeMoves(merged: ClientSummary): { key: TranslationKey; count: number }[] {
  const M = 'modules.clients.merge.moves'
  return (
    [
      { key: `${M}.relations`, count: merged.relations.length },
      { key: `${M}.insurances`, count: merged.insurances.length },
      { key: `${M}.payers`, count: merged.payers.length },
      { key: `${M}.tags`, count: merged.tags.length },
      { key: `${M}.professionals`, count: merged.professionals.length },
    ] as const
  ).filter((m) => m.count > 0)
}
