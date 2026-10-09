import { z } from 'zod'
import { t } from '@/i18n'
import { optionalEmail, optionalPattern, optionalPhone, optionalPostalCode, PROVINCES } from '@/shared/lib/field-schemas'
import { compactTaxNumber, formatPhone, formatTaxNumber } from '@/shared/lib/format'
import { isCalendarDate } from '@/shared/lib/timezone'
import { AVAILABILITY_PERIODS, type AvailabilityPeriod } from '../lib/constants'
import type { CatalogView } from '../lib/catalog-view'
import { ACCOUNT, BUSINESS_NUMBER, GST, INSTITUTION, isValidSin, QST, strip, TRANSIT } from './private'
import { professionsSchema, type ProfessionItemValues } from './professions'
import { longText, tidyText } from './text'

/**
 * The questionnaire's step forms (4b.4). Form fields carry the section's keys
 * (`private.submission_fields()`), so a database HINT names the form field, and each field parses
 * on its own into the value the database stores (`private.normalize_submission_section`): the
 * autosave sends only the fields that parse and changed, « Continuer » checks the whole step.
 * Required fields are what `private.submission_gaps` needs (P4-173). The database still decides.
 */

const Q = 'modules.professionals.questionnaire.validation'

/** A schema whose output must not be null: « required » on top of an optional field's rules. */
const required = <S extends z.ZodType<unknown, string>>(schema: S, message: string) =>
  schema.refine((v) => v !== null, { error: message })

// --- Renseignements personnels ------------------------------------------------------------------

export const personalSchema = z.object({
  personal_phone: required(optionalPhone(), t(`${Q}.phoneRequired`)),
  address_line1: tidyText({ max: 200, requiredMessage: t(`${Q}.addressRequired`) }),
  address_line2: tidyText({ max: 200 }),
  city: tidyText({ max: 100, requiredMessage: t(`${Q}.cityRequired`) }),
  province: z.enum(PROVINCES, { error: t('settings.validation.province') }),
  postal_code: required(optionalPostalCode(), t(`${Q}.postalCodeRequired`)),
})
export type PersonalValues = z.input<typeof personalSchema>

const str = (values: Readonly<Record<string, unknown>>, key: string): string => {
  const value = values[key]
  return typeof value === 'string' ? value : ''
}

export function toPersonalValues(values: Readonly<Record<string, unknown>>): PersonalValues {
  const province = str(values, 'province')
  return {
    personal_phone: formatPhone(str(values, 'personal_phone')),
    address_line1: str(values, 'address_line1'),
    address_line2: str(values, 'address_line2'),
    city: str(values, 'city'),
    province: ((PROVINCES as readonly string[]).includes(province) ? province : 'QC') as PersonalValues['province'],
    postal_code: str(values, 'postal_code'),
  }
}

// --- Profil professionnel -------------------------------------------------------------------------

/** One title as the section stores it. */
interface SubmittedProfession {
  title_id: string
  licence_number: string | null
  is_primary: boolean
}

const yearsField = () =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^[0-9]{1,2}$/.test(v) && Number(v) <= 60), { error: t('modules.professionals.validation.yearsExperience') })
    .transform((v) => (v === '' ? null : Number(v)))

/**
 * Titles (at most two, a licence for a title of an order, P4-33 years 0–60). The titles held when
 * the questionnaire opened may stay archived; restricted motifs need a regulated title.
 */
export function professionalSchema(catalog: CatalogView, context: { heldTitleIds: readonly string[]; heldMotifIds: readonly string[] }) {
  return z.object({
    professions: professionsSchema(catalog, context)
      .refine((items) => items.length > 0, { error: t(`${Q}.titleRequired`) })
      .transform((items): SubmittedProfession[] => items.map((i) => ({ title_id: i.titleId, licence_number: i.licenceNumber, is_primary: i.isPrimary }))),
    years_experience: yearsField(),
  })
}
export type ProfessionalValues = { professions: ProfessionItemValues[]; years_experience: string }

/** The section's titles, whatever their shape in the prefill (malformed rows are dropped). */
export function submittedProfessions(values: Readonly<Record<string, unknown>>): SubmittedProfession[] {
  const items = values.professions
  if (!Array.isArray(items)) return []
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const row = item as Record<string, unknown>
    if (typeof row.title_id !== 'string') return []
    return [{ title_id: row.title_id, licence_number: typeof row.licence_number === 'string' ? row.licence_number : null, is_primary: row.is_primary === true }]
  })
}

export function toProfessionalValues(values: Readonly<Record<string, unknown>>): ProfessionalValues {
  const years = values.years_experience
  return {
    professions: submittedProfessions(values).map((p) => ({ titleId: p.title_id, licenceNumber: p.licence_number ?? '', isPrimary: p.is_primary })),
    years_experience: typeof years === 'number' ? String(years) : '',
  }
}

// --- Portrait -------------------------------------------------------------------------------------

export const portraitSchema = z.object({
  bio: longText(4000).refine((v) => v !== null, { error: t(`${Q}.bioRequired`) }),
  approach: longText(4000),
  // Stored lower-cased, 254 characters at most (`normalize_submission_section`).
  public_email: optionalEmail()
    .transform((v) => v?.toLowerCase() ?? null)
    .refine((v) => v === null || v.length <= 254, { error: t('auth.errors.invalidEmail') }),
  public_phone: optionalPhone(),
})
export type PortraitValues = z.input<typeof portraitSchema>

export function toPortraitValues(values: Readonly<Record<string, unknown>>): PortraitValues {
  return {
    bio: str(values, 'bio'),
    approach: str(values, 'approach'),
    public_email: str(values, 'public_email'),
    public_phone: formatPhone(str(values, 'public_phone')),
  }
}

// --- Clientèles: the client limits (P4-245); the set itself is the picker's ---------------------

export const clientLimitsSchema = z.object({
  min_client_age: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^[0-9]{1,3}$/.test(v) && Number(v) <= 120), { error: t('modules.professionals.validation.ages') })
    .transform((v) => (v === '' ? null : Number(v))),
  women_only: z.boolean(),
})
export type ClientLimitsValues = z.input<typeof clientLimitsSchema>

export function toClientLimitsValues(values: Readonly<Record<string, unknown>>): ClientLimitsValues {
  const age = values.min_client_age
  return { min_client_age: typeof age === 'number' ? String(age) : '', women_only: values.women_only === true }
}

// --- Disponibilités générales (P4-250: « Fin de journée » included) -------------------------------

export const availabilitySchema = z.object({
  availability_periods: z.array(z.enum(AVAILABILITY_PERIODS)).transform((periods) => AVAILABILITY_PERIODS.filter((p) => periods.includes(p))),
  accepting_new_clients: z.boolean(),
  availability_note: longText(500),
})
export type AvailabilityValues = z.input<typeof availabilitySchema>

export function toAvailabilityValues(values: Readonly<Record<string, unknown>>): AvailabilityValues {
  const periods = Array.isArray(values.availability_periods) ? values.availability_periods : []
  return {
    availability_periods: AVAILABILITY_PERIODS.filter((p): p is AvailabilityPeriod => periods.includes(p)),
    // A new file has no matching profile yet: the column's default is « accepts ».
    accepting_new_clients: values.accepting_new_clients !== false,
    availability_note: str(values, 'availability_note'),
  }
}

// --- Assurance: the expiry (the file is the dropzone's) --------------------------------------------

/** The expiry: a real date, not before the clinic's `today`, at most 2100-12-31 (P4-177). */
export function insuranceSchema(today: string) {
  return z.object({
    expires_on: z
      .string()
      .trim()
      .superRefine((v, ctx) => {
        if (v === '') return ctx.addIssue({ code: 'custom', message: t(`${Q}.expiryRequired`) })
        if (!isCalendarDate(v)) {
          return ctx.addIssue({ code: 'custom', message: t(`${Q}.dateInvalid`) })
        }
        if (v < today) ctx.addIssue({ code: 'custom', message: t(`${Q}.expiryPast`) })
        else if (v > '2100-12-31') ctx.addIssue({ code: 'custom', message: t(`${Q}.expiryTooFar`) })
      }),
  })
}
export type InsuranceValues = { expires_on: string }

// --- Per-field parsing (the autosave) ------------------------------------------------------------

/**
 * The fields of `values` that parse on their own, as stored (fields still being typed, or invalid,
 * are left out: the autosave never sends them; « Continuer » shows their error).
 */
export function parseValidFields(schema: z.ZodObject, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema.shape)) {
    const result = (field as z.ZodType).safeParse(values[key])
    if (result.success) out[key] = result.data
  }
  return out
}

// --- Fiscalité et banque (never autosaved, never kept in a draft: P4-38) ------------------------

export type TaxBankValues = {
  business_number: string
  gst_number: string
  qst_number: string
  bank_institution: string
  bank_transit: string
  bank_account: string
  sin: string
}

/**
 * The private step as `save_my_submission_private` checks it (4a.17's rules and messages): numbers
 * lose spaces and hyphens. « Dépôt direct » is optional but whole or empty (P4-480, as
 * `private.submission_gaps`): once one of institution, transit and account is given (an account on
 * file counts), the missing ones are required. The account and the SIN are never prefilled (blank
 * keeps what is stored); the SIN is required only when nothing is on file, and asked only while the
 * clinic collects it (P4-272).
 */
export function taxBankSchema({ accountOnFile, sinOnFile, collectSin }: { accountOnFile: boolean; sinOnFile: boolean; collectSin: boolean }) {
  const secret = (pattern: RegExp | null, valid: (digits: string) => boolean, messages: { required: string | null; invalid: string }) =>
    z.string().transform((v, ctx) => {
      const digits = strip(v)
      if (digits === '') {
        if (messages.required) ctx.addIssue({ code: 'custom', message: messages.required })
        return null
      }
      if ((pattern && !pattern.test(digits)) || !valid(digits)) {
        ctx.addIssue({ code: 'custom', message: messages.invalid })
        return z.NEVER
      }
      return digits
    })
  return z.object({
    business_number: optionalPattern(BUSINESS_NUMBER, t('modules.professionals.validation.businessNumber'), strip),
    gst_number: optionalPattern(GST, t('modules.professionals.validation.gstNumber'), compactTaxNumber),
    qst_number: optionalPattern(QST, t('modules.professionals.validation.qstNumber'), compactTaxNumber),
    bank_institution: optionalPattern(INSTITUTION, t('settings.bank.validation.institution'), strip),
    bank_transit: optionalPattern(TRANSIT, t('settings.bank.validation.transit'), strip),
    bank_account: secret(ACCOUNT, () => true, { required: null, invalid: t('settings.bank.validation.account') }),
    sin: collectSin
      ? secret(null, isValidSin, { required: sinOnFile ? null : t(`${Q}.sinRequired`), invalid: t('modules.professionals.validation.sinInvalid') })
      : z.string().transform(() => null),
  }).superRefine((v, ctx) => {
    const account = v.bank_account !== null || accountOnFile
    if (v.bank_institution === null && v.bank_transit === null && !account) return
    if (v.bank_institution === null) ctx.addIssue({ code: 'custom', path: ['bank_institution'], message: t(`${Q}.institutionRequired`) })
    if (v.bank_transit === null) ctx.addIssue({ code: 'custom', path: ['bank_transit'], message: t(`${Q}.transitRequired`) })
    if (!account) ctx.addIssue({ code: 'custom', path: ['bank_account'], message: t(`${Q}.accountRequired`) })
  })
}

/** Whether « Dépôt direct » is started (one value typed, or an account on file): its three fields are then required (P4-480). */
export function depositStarted(values: { bank_institution?: string; bank_transit?: string; bank_account?: string }, accountOnFile: boolean): boolean {
  return accountOnFile || [values.bank_institution, values.bank_transit, values.bank_account].some((v) => strip(v ?? '') !== '')
}

/** The plain numbers shown (the submission's, else the record's); the account and the SIN always empty. */
export function toTaxBankValues(source: {
  businessNumber: string | null
  gstNumber: string | null
  qstNumber: string | null
  bankInstitution: string | null
  bankTransit: string | null
} | null): TaxBankValues {
  return {
    business_number: source?.businessNumber ?? '',
    gst_number: formatTaxNumber(source?.gstNumber ?? null),
    qst_number: formatTaxNumber(source?.qstNumber ?? null),
    bank_institution: source?.bankInstitution ?? '',
    bank_transit: source?.bankTransit ?? '',
    bank_account: '',
    sin: '',
  }
}
