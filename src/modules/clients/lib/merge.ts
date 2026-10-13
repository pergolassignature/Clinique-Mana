import { t, type TranslationKey } from '@/i18n'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import type { ClientFields, ClientsReference } from '../api/clients'
import type { Client, ClientSummary } from '../api/parse'
import { languageLabel, phoneLabel, rateVariantLabel, sexLabel } from './display'

/**
 * The merge screen's comparison (plan C4.1, CL-24), pure. Each row is one value of the file, or
 * the address as a block (`merge_clients` fills an address only as a whole):
 * - both files hold a value and they differ: a choice, the kept file's value first;
 * - only the merged file holds one: it is taken (the database fills the kept file's empty fields);
 * - otherwise the row is left out.
 * The chosen values of the merged file are sent as `merge_clients`' fields (RPC keys).
 */

export interface MergeRow {
  key: string
  labelKey: TranslationKey
  kept: string | null
  merged: string | null
  /** The merged file's values for the RPC when this row takes them. */
  fields: ClientFields
  /** true: both hold a value and they differ; false: the kept file has none, the merged one's is taken. */
  choice: boolean
}

type Field = {
  key: string
  labelKey: TranslationKey
  rpc: readonly (keyof Client)[]
  /** The value as shown, or null when the file has none. */
  show: (client: Client, reference: ClientsReference | undefined) => string | null
}

const F = 'modules.clients.fields'
const nameOf = (options: readonly { id: string; name: string }[] | undefined, id: string | null) =>
  id === null ? null : (options?.find((o) => o.id === id)?.name ?? t('modules.clients.merge.unknownValue'))
const RPC_KEY: Partial<Record<keyof Client, string>> = {
  firstName: 'first_name',
  lastName: 'last_name',
  birthFirstName: 'birth_first_name',
  pronouns: 'pronouns',
  sex: 'sex',
  birthday: 'birthday',
  language: 'language',
  email: 'email',
  mobile: 'mobile_e164',
  home: 'home_e164',
  work: 'work_e164',
  workExt: 'work_ext',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  province: 'province',
  postalCode: 'postal_code',
  country: 'country',
  referralSourceId: 'referral_source_id',
  referredBy: 'referred_by',
  primaryProfessionalId: 'primary_professional_id',
  rateVariant: 'rate_variant',
}

const FIELDS: readonly Field[] = [
  { key: 'firstName', labelKey: `${F}.firstName`, rpc: ['firstName'], show: (c) => c.firstName },
  { key: 'lastName', labelKey: `${F}.lastName`, rpc: ['lastName'], show: (c) => c.lastName },
  { key: 'birthFirstName', labelKey: `${F}.birthFirstName`, rpc: ['birthFirstName'], show: (c) => c.birthFirstName },
  { key: 'pronouns', labelKey: `${F}.pronouns`, rpc: ['pronouns'], show: (c) => c.pronouns },
  { key: 'sex', labelKey: `${F}.sex`, rpc: ['sex'], show: (c) => c.sex && sexLabel(c.sex) },
  { key: 'birthday', labelKey: `${F}.birthday`, rpc: ['birthday'], show: (c) => c.birthday && formatDateOnlyShort(c.birthday) },
  { key: 'language', labelKey: `${F}.language`, rpc: ['language'], show: (c) => languageLabel(c.language) },
  { key: 'email', labelKey: `${F}.email`, rpc: ['email'], show: (c) => c.email },
  { key: 'mobile', labelKey: `${F}.mobile`, rpc: ['mobile'], show: (c) => c.mobile && phoneLabel(c.mobile) },
  { key: 'home', labelKey: `${F}.home`, rpc: ['home'], show: (c) => c.home && phoneLabel(c.home) },
  {
    key: 'work',
    labelKey: `${F}.work`,
    rpc: ['work', 'workExt'],
    show: (c) => c.work && [phoneLabel(c.work), c.workExt && t('modules.clients.merge.ext', { ext: c.workExt })].filter(Boolean).join(' '),
  },
  {
    key: 'address',
    labelKey: 'modules.clients.merge.address',
    rpc: ['addressLine1', 'addressLine2', 'city', 'province', 'postalCode', 'country'],
    show: (c) =>
      c.addressLine1 || c.city || c.postalCode ? [c.addressLine1, c.addressLine2, c.city, c.province, c.postalCode].filter(Boolean).join(', ') : null,
  },
  { key: 'referralSourceId', labelKey: `${F}.referralSource`, rpc: ['referralSourceId'], show: (c, r) => nameOf(r?.referralSources, c.referralSourceId) },
  { key: 'referredBy', labelKey: `${F}.referredBy`, rpc: ['referredBy'], show: (c) => c.referredBy },
  {
    key: 'primaryProfessionalId',
    labelKey: `${F}.primaryProfessional`,
    rpc: ['primaryProfessionalId'],
    show: (c, r) => nameOf(r?.professionals, c.primaryProfessionalId),
  },
  { key: 'rateVariant', labelKey: `${F}.rateVariant`, rpc: ['rateVariant'], show: (c) => c.rateVariant && rateVariantLabel(c.rateVariant) },
]

/** The merged file's values for a row, as the RPC takes them. */
function fieldsOf(client: Client, rpc: readonly (keyof Client)[]): ClientFields {
  const fields: ClientFields = {}
  for (const key of rpc) {
    const value = client[key]
    fields[RPC_KEY[key] as string] = typeof value === 'boolean' || typeof value === 'string' || value === null ? value : String(value)
  }
  return fields
}

/** The rows to show for keeping `kept` and merging `merged` into it. */
export function mergeRows(kept: Client, merged: Client, reference?: ClientsReference): MergeRow[] {
  return FIELDS.flatMap((field) => {
    const keptValue = field.show(kept, reference)
    const mergedValue = field.show(merged, reference)
    if (!mergedValue) return []
    if (keptValue && keptValue === mergedValue) return []
    return [{ key: field.key, labelKey: field.labelKey, kept: keptValue || null, merged: mergedValue, fields: fieldsOf(merged, field.rpc), choice: Boolean(keptValue) }]
  })
}

/** `merge_clients`' fields: the merged file's values of the rows where the person took them. */
export function chosenFields(rows: readonly MergeRow[], takeMerged: ReadonlySet<string>): ClientFields {
  return Object.assign({}, ...rows.filter((row) => row.choice && takeMerged.has(row.key)).map((row) => row.fields)) as ClientFields
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
