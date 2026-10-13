import { z } from 'zod'
import { t } from '@/i18n'
import { emptyToNull, optionalEmail, optionalPhone, optionalPostalCode, optionalProvince, optionalText, requiredText } from '@/shared/lib/field-schemas'
import { formatPhone } from '@/shared/lib/format'
import { isCalendarDate } from '@/shared/lib/timezone'
import type { ClientFields } from '../api/clients'
import type { Client } from '../api/parse'
import { LANGUAGES, RATE_VARIANTS, SEXES } from '../lib/constants'

/**
 * The file's form (the creation dialog and the record's « Informations » cards), mirroring
 * `create_client` / `update_client`: strings in, normalised values out (trimmed, empty → null,
 * phones to E.164, postal code `A1A 1A1`). The database stays authoritative: its refusals carry
 * the field as HINT. Each card validates and sends only its own fields (`clientCardSchema`,
 * `toClientFields`): `update_client` changes the keys it gets and keeps the others.
 */

const V = 'modules.clients.validation'

export type ClientFormValues = {
  firstName: string
  lastName: string
  birthFirstName: string
  pronouns: string
  sex: string
  birthday: string
  email: string
  mobile: string
  home: string
  work: string
  workExt: string
  language: string
  remindersBySms: boolean
  remindersByEmail: boolean
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  country: string
  referralSourceId: string
  referredBy: string
  /** « Référé par » a file of the clinic (its id; '' none): never with `referredBy` (CL-19). */
  referredByClientId: string
  customField: string
  primaryProfessionalId: string
  rateVariant: string
  taxExempt: boolean
  isBanned: boolean
  fileIncomplete: boolean
  specialAgreement: boolean
  sharedCustody: boolean
}

export type ClientFieldKey = keyof ClientFormValues

/** The value each field sends (null for an empty optional one). */
export type ClientFieldOutput = Partial<Record<ClientFieldKey, string | boolean | null>>

const optionalCode = <T extends readonly string[]>(codes: T, message: string) =>
  z
    .string()
    .refine((v) => v === '' || (codes as readonly string[]).includes(v), { error: message })
    .transform(emptyToNull)

const birthday = z
  .string()
  .trim()
  .refine((v) => v === '' || (isCalendarDate(v) && v >= '1900-01-01'), { error: t(`${V}.birthday`) })
  .transform(emptyToNull)

/** Every field's schema; a card picks its own. */
const FIELDS = {
  firstName: requiredText(100, t(`${V}.firstName`)),
  lastName: requiredText(100, t(`${V}.lastName`)),
  birthFirstName: optionalText(100),
  pronouns: optionalText(40),
  sex: optionalCode(SEXES, t(`${V}.sex`)),
  birthday,
  email: optionalEmail(),
  mobile: optionalPhone(),
  home: optionalPhone(),
  work: optionalPhone(),
  workExt: z
    .string()
    .transform((v) => v.replace(/\s/g, ''))
    .refine((v) => /^[0-9]{0,10}$/.test(v), { error: t(`${V}.workExt`) })
    .transform(emptyToNull),
  language: z.enum(LANGUAGES, { error: t(`${V}.language`) }),
  remindersBySms: z.boolean(),
  remindersByEmail: z.boolean(),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  // Checked against the country below (a Canadian code, or free text abroad).
  province: z.string().trim(),
  postalCode: z.string().trim(),
  country: z.string().trim(),
  referralSourceId: z.string().transform(emptyToNull),
  referredBy: optionalText(200),
  referredByClientId: z.string().transform(emptyToNull),
  customField: optionalText(200),
  primaryProfessionalId: z.string().transform(emptyToNull),
  rateVariant: optionalCode(RATE_VARIANTS, t(`${V}.rateVariant`)),
  taxExempt: z.boolean(),
  isBanned: z.boolean(),
  fileIncomplete: z.boolean(),
  specialAgreement: z.boolean(),
  sharedCustody: z.boolean(),
} satisfies Record<ClientFieldKey, z.ZodType>

/** The province and postal code: Canadian forms in Canada, free text (≤ 100 / ≤ 20) abroad. */
function addressRefine(values: { province?: string; postalCode?: string; country?: string }, ctx: z.RefinementCtx) {
  const country = (values.country || 'CA').toUpperCase()
  if (country === 'CA') {
    const province = optionalProvince().safeParse(values.province ?? '')
    if (!province.success) ctx.addIssue({ code: 'custom', path: ['province'], message: province.error.issues[0]?.message ?? '' })
    const postal = optionalPostalCode().safeParse(values.postalCode ?? '')
    if (!postal.success) ctx.addIssue({ code: 'custom', path: ['postalCode'], message: postal.error.issues[0]?.message ?? '' })
  } else {
    if ((values.province ?? '').length > 100) ctx.addIssue({ code: 'custom', path: ['province'], message: t(`${V}.provinceAbroad`) })
    if ((values.postalCode ?? '').length > 20) ctx.addIssue({ code: 'custom', path: ['postalCode'], message: t(`${V}.postalCodeAbroad`) })
  }
}

/** The output of the address fields once checked (the province upper-cased in Canada, the code formatted). */
function addressOutput(values: { province?: string; postalCode?: string; country?: string }) {
  const country = (values.country || 'CA').toUpperCase()
  if (country === 'CA') {
    return {
      province: optionalProvince().parse(values.province ?? ''),
      postalCode: optionalPostalCode().parse(values.postalCode ?? ''),
      country,
    }
  }
  return { province: emptyToNull(values.province ?? ''), postalCode: emptyToNull(values.postalCode ?? ''), country }
}

/**
 * A card's schema: its fields only (`keys`); with the address fields, the country rule. The output
 * holds the card's fields, normalised.
 */
export function clientCardSchema(keys: readonly ClientFieldKey[]) {
  const shape = Object.fromEntries(keys.map((key) => [key, FIELDS[key]])) as Record<string, z.ZodType>
  const withAddress = keys.includes('province') || keys.includes('postalCode')
  return z
    .object(shape)
    .superRefine((values, ctx) => {
      if (withAddress) addressRefine(values as { province?: string; postalCode?: string; country?: string }, ctx)
    })
    .transform((values) => {
      const output = { ...(values as ClientFieldOutput) }
      if (withAddress) Object.assign(output, addressOutput(values as { province?: string; postalCode?: string; country?: string }))
      return output
    }) as unknown as z.ZodType<ClientFieldOutput, ClientFormValues>
}

/** Every field, for the creation dialog. */
export const ALL_CLIENT_FIELDS = Object.keys(FIELDS) as ClientFieldKey[]

/** A new file's form: French, reminders by text and by email (R-54), in Canada. */
export function emptyClientForm(): ClientFormValues {
  return {
    firstName: '',
    lastName: '',
    birthFirstName: '',
    pronouns: '',
    sex: '',
    birthday: '',
    email: '',
    mobile: '',
    home: '',
    work: '',
    workExt: '',
    language: 'fr',
    remindersBySms: true,
    remindersByEmail: true,
    addressLine1: '',
    addressLine2: '',
    city: '',
    province: 'QC',
    postalCode: '',
    country: 'CA',
    referralSourceId: '',
    referredBy: '',
    referredByClientId: '',
    customField: '',
    primaryProfessionalId: '',
    rateVariant: '',
    taxExempt: false,
    isBanned: false,
    fileIncomplete: false,
    specialAgreement: false,
    sharedCustody: false,
  }
}

/** A stored file as form values (phones regrouped as the clinic types them). */
export function clientFormValues(client: Client): ClientFormValues {
  return {
    firstName: client.firstName,
    lastName: client.lastName,
    birthFirstName: client.birthFirstName ?? '',
    pronouns: client.pronouns ?? '',
    sex: client.sex ?? '',
    birthday: client.birthday ?? '',
    email: client.email ?? '',
    mobile: formatPhone(client.mobile),
    home: formatPhone(client.home),
    work: formatPhone(client.work),
    workExt: client.workExt ?? '',
    language: client.language,
    remindersBySms: client.remindersBySms,
    remindersByEmail: client.remindersByEmail,
    addressLine1: client.addressLine1 ?? '',
    addressLine2: client.addressLine2 ?? '',
    city: client.city ?? '',
    province: client.province ?? '',
    postalCode: client.postalCode ?? '',
    country: client.country,
    referralSourceId: client.referralSourceId ?? '',
    referredBy: client.referredBy ?? '',
    referredByClientId: client.referredByClientId ?? '',
    customField: client.customField ?? '',
    primaryProfessionalId: client.primaryProfessionalId ?? '',
    rateVariant: client.rateVariant ?? '',
    taxExempt: client.taxExempt,
    isBanned: client.isBanned,
    fileIncomplete: client.fileIncomplete,
    specialAgreement: client.specialAgreement,
    sharedCustody: client.sharedCustody,
  }
}

/** The RPC's key for each form field. */
const RPC_KEYS: Record<ClientFieldKey, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  birthFirstName: 'birth_first_name',
  pronouns: 'pronouns',
  sex: 'sex',
  birthday: 'birthday',
  email: 'email',
  mobile: 'mobile_e164',
  home: 'home_e164',
  work: 'work_e164',
  workExt: 'work_ext',
  language: 'language',
  remindersBySms: 'reminders_by_sms',
  remindersByEmail: 'reminders_by_email',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  province: 'province',
  postalCode: 'postal_code',
  country: 'country',
  referralSourceId: 'referral_source_id',
  referredBy: 'referred_by',
  referredByClientId: 'referred_by_client_id',
  customField: 'custom_field',
  primaryProfessionalId: 'primary_professional_id',
  rateVariant: 'rate_variant',
  taxExempt: 'tax_exempt',
  isBanned: 'is_banned',
  fileIncomplete: 'file_incomplete',
  specialAgreement: 'special_agreement',
  sharedCustody: 'shared_custody',
}

/** The form field a refusal's HINT names (the RPC's key), or null. */
export function fieldOfHint(hint: string | undefined): ClientFieldKey | null {
  if (!hint) return null
  const found = (Object.entries(RPC_KEYS) as [ClientFieldKey, string][]).find(([, key]) => key === hint)
  return found ? found[0] : null
}

/** Normalised form output as the RPC's JSON (snake_case keys). */
export function toClientFields(output: ClientFieldOutput): ClientFields {
  const fields: ClientFields = {}
  for (const [key, value] of Object.entries(output) as [ClientFieldKey, string | boolean | null][]) fields[RPC_KEYS[key]] = value
  return fields
}
