import { z } from 'zod'
import { t } from '@/i18n'
import { optionalPattern } from '@/shared/lib/field-schemas'
import { GENDERS, type Gender } from '../lib/constants'
import type { PayerNumber, Professional } from '../api/parse'
import { tidyText } from './text'

/**
 * « Identité et permis » cards (`professionals.manage`), as the database checks them
 * (20261008133537_professionals_core.sql). Forms work on strings; each schema normalises them.
 */

/** A first or last name: 1–80 characters, tidy like `create_professional`'s names. */
export const personNameField = (requiredMessage: string) => tidyText({ max: 80, requiredMessage })

/** « Identité »: names, and the gender used only for the client's preference (P4-5). */
export const identitySchema = z.object({
  firstName: personNameField(t('modules.professionals.validation.firstNameRequired')),
  lastName: personNameField(t('modules.professionals.validation.lastNameRequired')),
  gender: z.union([z.literal(''), z.enum(GENDERS)]).transform((v): Gender | null => (v === '' ? null : v)),
})
type IdentityValues = z.input<typeof identitySchema>

export function toIdentityFormValues(p: Professional): IdentityValues {
  return { firstName: p.firstName, lastName: p.lastName, gender: p.gender ?? '' }
}

/** « Expérience »: whole years, 0–60 (P4-33), or empty. */
export const experienceSchema = z.object({
  yearsExperience: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^[0-9]{1,2}$/.test(v) && Number(v) <= 60), { error: t('modules.professionals.validation.yearsExperience') })
    .transform((v) => (v === '' ? null : Number(v))),
})
type ExperienceValues = z.input<typeof experienceSchema>

export function toExperienceFormValues(p: Professional): ExperienceValues {
  return { yearsExperience: p.yearsExperience === null ? '' : String(p.yearsExperience) }
}

/** `professional_payer_numbers_number_check`, on the upper-cased number. */
const IVAC = /^[A-Z0-9-]{3,30}$/

/** An IVAC number as `set_professional_payer_number` stores it: trimmed, upper-cased (unique whatever the case). */
export const normalizeIvac = (value: string) => value.trim().toUpperCase()

/** « Numéros de payeurs »: the IVAC number, upper-cased; empty deletes it. */
export const payerNumbersSchema = z.object({
  ivac: optionalPattern(IVAC, t('modules.professionals.validation.ivac'), normalizeIvac),
})
type PayerNumbersValues = z.input<typeof payerNumbersSchema>

/** « Expérience et payeurs » (decision UI-5): the years of experience and the IVAC number, one save. */
export const experienceAndPayersSchema = experienceSchema.extend(payerNumbersSchema.shape)

export function toPayerNumbersFormValues(payerNumbers: readonly PayerNumber[]): PayerNumbersValues {
  return { ivac: payerNumbers.find((p) => p.type === 'ivac')?.number ?? '' }
}
