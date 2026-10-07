import { z } from 'zod'
import { formatPhone, formatPostalCode, parsePhone } from '@/shared/lib/format'
import type { Organization } from './api'

/**
 * One schema per settings card. The forms work on strings; each schema normalises them (trim,
 * empty → null, canonical formats) and validates with the same patterns as the database checks
 * in 20261007202941_core_organization_profile.sql. Digits are `[0-9]`, never `\d`, as in SQL.
 * Each `to…FormValues(org)` turns a stored row back into the card's form values (null → '').
 */

const MESSAGES = {
  nameRequired: 'Le nom est requis.',
  maxLength: (max: number) => `${max} caractères maximum.`,
  neq: 'Le NEQ compte 10 chiffres.',
  gst: 'Format attendu : 123456789 RT 0001.',
  qst: 'Format attendu : 1234567890 TQ 0001.',
  province: 'Province invalide.',
  postalCode: 'Code postal invalide (ex. : H2X 1Y4).',
  phone: 'Numéro à 10 chiffres.',
  https: "L'adresse doit commencer par https://",
  email: 'Courriel invalide.',
  retention: 'Entre 1 et 50 ans.',
  timezone: 'Choisissez un fuseau horaire.',
} as const

/** The 13 province and territory codes allowed by `organizations_province_check`. */
export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const
export type Province = (typeof PROVINCES)[number]

const NEQ = /^[0-9]{10}$/
const GST = /^[0-9]{9}RT[0-9]{4}$/
const QST = /^[0-9]{10}TQ[0-9]{4}$/
const POSTAL_CODE = /^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const HTTPS_URL = /^https:\/\/\S+$/
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

const emptyToNull = <T>(v: T | '') => (v === '' ? null : v)

/** Optional free text: trimmed, empty → null, at most `max` characters. */
const optionalText = (max: number) => z.string().trim().max(max, { error: MESSAGES.maxLength(max) }).transform(emptyToNull)

/** Optional formatted value: trimmed, normalised, then empty → null or checked against `pattern`. */
const optionalPattern = (pattern: RegExp, message: string, normalize: (v: string) => string = (v) => v) =>
  z
    .string()
    .transform((v) => normalize(v.trim()))
    .refine((v) => v === '' || pattern.test(v), { error: message })
    .transform(emptyToNull)

/** `12 34-5 rt` → `12345RT`: tax and enterprise numbers are typed with spaces and dashes. */
const compactUpper = (v: string) => v.replace(/[\s-]/g, '').toUpperCase()

/** Lowercases the scheme, and adds `https://` when there is none (`www.x.ca` → `https://www.x.ca`). */
function normalizeUrl(v: string): string {
  if (v === '') return v
  const scheme = URL_SCHEME.exec(v)
  return scheme ? scheme[0].toLowerCase() + v.slice(scheme[0].length) : `https://${v}`
}

const optionalEmail = () => optionalPattern(EMAIL, MESSAGES.email)
const optionalHttpsUrl = () => optionalPattern(HTTPS_URL, MESSAGES.https, normalizeUrl)
const str = (v: string | null) => v ?? ''

// --- Identité légale: « Clinique » ---------------------------------------------------------------

export const clinicSchema = z.object({
  name: z.string().trim().min(1, { error: MESSAGES.nameRequired }).max(200, { error: MESSAGES.maxLength(200) }),
  legal_name: optionalText(200),
  neq: optionalPattern(NEQ, MESSAGES.neq, compactUpper),
})

export function toClinicFormValues(org: Organization): z.input<typeof clinicSchema> {
  return { name: org.name, legal_name: str(org.legal_name), neq: str(org.neq) }
}

// --- Identité légale: « Adresse du siège social » ------------------------------------------------

export const addressSchema = z.object({
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: optionalText(100),
  // A string, not z.enum: the form's « no province » is '' (stored as null).
  province: z
    .string()
    .trim()
    .refine((v): v is Province | '' => v === '' || (PROVINCES as readonly string[]).includes(v), { error: MESSAGES.province })
    .transform(emptyToNull),
  postal_code: optionalPattern(POSTAL_CODE, MESSAGES.postalCode, formatPostalCode),
})

export function toAddressFormValues(org: Organization): z.input<typeof addressSchema> {
  return {
    address_line1: str(org.address_line1),
    address_line2: str(org.address_line2),
    city: str(org.city),
    province: str(org.province),
    postal_code: str(org.postal_code),
  }
}

// --- Identité légale: « Coordonnées » ------------------------------------------------------------

export const contactSchema = z.object({
  phone: z.string().transform((v, ctx) => {
    if (v.trim() === '') return null
    const parsed = parsePhone(v)
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: MESSAGES.phone })
      return z.NEVER
    }
    return parsed
  }),
  email: optionalEmail(),
  website: optionalHttpsUrl(),
})

export function toContactFormValues(org: Organization): z.input<typeof contactSchema> {
  // The phone is shown as typed in Quebec (514 555-1234); the schema parses it back to E.164.
  return { phone: formatPhone(org.phone), email: str(org.email), website: str(org.website) }
}

// --- Fiscalité: numbers --------------------------------------------------------------------------

export const taxNumbersSchema = z.object({
  gst_number: optionalPattern(GST, MESSAGES.gst, compactUpper),
  qst_number: optionalPattern(QST, MESSAGES.qst, compactUpper),
})

export function toTaxNumbersFormValues(org: Organization): z.input<typeof taxNumbersSchema> {
  return { gst_number: str(org.gst_number), qst_number: str(org.qst_number) }
}

// --- Signataire ----------------------------------------------------------------------------------

export const signatorySchema = z.object({
  signatory_name: optionalText(120),
  signatory_title: optionalText(120),
})

export function toSignatoryFormValues(org: Organization): z.input<typeof signatorySchema> {
  return { signatory_name: str(org.signatory_name), signatory_title: str(org.signatory_title) }
}

// --- Confidentialité (Loi 25) --------------------------------------------------------------------

export const privacySchema = z.object({
  privacy_officer_name: optionalText(120),
  privacy_officer_email: optionalEmail(),
  privacy_policy_url: optionalHttpsUrl(),
  // Whole years, 1–50 (`organizations_record_retention_years_check`); '' → null.
  record_retention_years: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^[0-9]{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 50), { error: MESSAGES.retention })
    .transform((v) => (v === '' ? null : Number(v))),
})

export function toPrivacyFormValues(org: Organization): z.input<typeof privacySchema> {
  return {
    privacy_officer_name: str(org.privacy_officer_name),
    privacy_officer_email: str(org.privacy_officer_email),
    privacy_policy_url: str(org.privacy_policy_url),
    record_retention_years: org.record_retention_years === null ? '' : String(org.record_retention_years),
  }
}

// --- Région --------------------------------------------------------------------------------------

/** The database checks the zone itself (`validate_org_timezone`); the picker only offers known zones. */
export const regionSchema = z.object({
  timezone: z.string().min(1, { error: MESSAGES.timezone }),
})

export function toRegionFormValues(org: Organization): z.input<typeof regionSchema> {
  return { timezone: org.timezone }
}
