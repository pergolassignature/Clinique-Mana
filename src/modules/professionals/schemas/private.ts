import { z } from 'zod'
import { t } from '@/i18n'
import { optionalPattern } from '@/shared/lib/field-schemas'
import { compactTaxNumber, formatTaxNumber } from '@/shared/lib/format'
import type { BankInput, ProfessionalPrivate, TaxNumbersInput } from '../api/private'

/**
 * The private-data forms (4a.18), mirroring 4a.17's RPCs (`set_professional_tax_numbers`,
 * `set_professional_bank`, `set_professional_sin`): numbers lose spaces, tabs, line breaks and
 * hyphens, anything else is an error (never stripped); TPS / TVQ letters are upper-cased. Messages
 * never repeat a value. The database still decides.
 */

/** What the database strips from every number: `[ \t\r\n-]`. */
const SEPARATORS = /[ \t\r\n-]/g
export const strip = (v: string) => v.replace(SEPARATORS, '')

export const BUSINESS_NUMBER = /^[0-9]{9}$/
export const GST = /^[0-9]{9}RT[0-9]{4}$/
export const QST = /^[0-9]{10}TQ[0-9]{4}$/
export const INSTITUTION = /^[0-9]{3}$/
export const TRANSIT = /^[0-9]{5}$/
export const ACCOUNT = /^[0-9]{7,12}$/
const SIN = /^[0-9]{9}$/

// --- Fiscalité ---------------------------------------------------------------------------------------

// Type aliases (not interfaces): useSettingsForm's FlatFormValues needs an index signature.
export type TaxNumbersFormValues = { businessNumber: string; gstNumber: string; qstNumber: string }

/** Empty clears a number (`set_professional_tax_numbers`: blank clears). */
export const taxNumbersSchema: z.ZodType<TaxNumbersInput, TaxNumbersFormValues> = z.object({
  businessNumber: optionalPattern(BUSINESS_NUMBER, t('modules.professionals.validation.businessNumber'), strip),
  gstNumber: optionalPattern(GST, t('modules.professionals.validation.gstNumber'), compactTaxNumber),
  qstNumber: optionalPattern(QST, t('modules.professionals.validation.qstNumber'), compactTaxNumber),
})

/** The stored numbers, TPS and TVQ grouped as « Fiscalité » shows them (the schema compacts them). */
export function toTaxNumbersFormValues(data: ProfessionalPrivate): TaxNumbersFormValues {
  return {
    businessNumber: data.businessNumber ?? '',
    gstNumber: formatTaxNumber(data.gstNumber),
    qstNumber: formatTaxNumber(data.qstNumber),
  }
}

// --- Banque ------------------------------------------------------------------------------------------

export type BankFormValues = { institution: string; transit: string; account: string }

/**
 * Institution and transit: empty clears (partial bank data is allowed, P4-141). The account is
 * never prefilled: empty keeps the stored one (null); typed, 7 to 12 digits once stripped.
 */
export const bankSchema: z.ZodType<BankInput, BankFormValues> = z.object({
  institution: optionalPattern(INSTITUTION, t('settings.bank.validation.institution'), strip),
  transit: optionalPattern(TRANSIT, t('settings.bank.validation.transit'), strip),
  account: z.string().transform((v, ctx) => {
    const digits = strip(v)
    if (digits === '') return null
    if (!ACCOUNT.test(digits)) {
      ctx.addIssue({ code: 'custom', message: t('settings.bank.validation.account') })
      return z.NEVER
    }
    return digits
  }),
})

/** The stored institution and transit; never the account (the field stays empty: « Inchangé »). */
export function toBankFormValues(data: ProfessionalPrivate): BankFormValues {
  return { institution: data.bankInstitution ?? '', transit: data.bankTransit ?? '', account: '' }
}

// --- NAS ---------------------------------------------------------------------------------------------

/**
 * The Luhn check of `private.is_valid_sin` (P4-143): 9 digits; every second digit doubled (its
 * digits summed), the total a multiple of 10. No rule on the first digit.
 */
export function isValidSin(digits: string): boolean {
  if (!SIN.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 9; i += 1) {
    const digit = Number(digits[i]) * (i % 2 === 1 ? 2 : 1)
    sum += digit > 9 ? digit - 9 : digit
  }
  return sum % 10 === 0
}

export type SinFormValues = { sin: string }

/** A whole SIN, digits only once stripped. Removing one is « Retirer », never a blank save. */
export const sinSchema: z.ZodType<{ sin: string }, SinFormValues> = z.object({
  sin: z.string().transform((v, ctx) => {
    const digits = strip(v)
    if (digits === '') {
      ctx.addIssue({ code: 'custom', message: t('modules.professionals.validation.sinRequired') })
      return z.NEVER
    }
    if (!isValidSin(digits)) {
      ctx.addIssue({ code: 'custom', message: t('modules.professionals.validation.sinInvalid') })
      return z.NEVER
    }
    return digits
  }),
})
