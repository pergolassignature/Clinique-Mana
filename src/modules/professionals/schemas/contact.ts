import { z } from 'zod'
import { t } from '@/i18n'
import { EMAIL_PATTERN } from '@/shared/lib/email'
import { optionalPhone, optionalPostalCode, optionalText, PROVINCES, withoutControlChars } from '@/shared/lib/field-schemas'
import { formatPhone } from '@/shared/lib/format'
import type { Professional } from '../api/parse'

/**
 * « Coordonnées » (`professionals.manage`), as `professionals_*_check` and
 * `private.professional_email` check them. The address is entered by hand in 4a (P4-12).
 */

/** The login and invitation address: trimmed, lower-cased (stored so), 254 characters at most. */
export const loginEmailField = () =>
  withoutControlChars(
    z
      .string()
      .max(254, { error: t('modules.professionals.validation.email') })
      .regex(EMAIL_PATTERN, { error: t('modules.professionals.validation.email') })
      .transform((v) => v.toLowerCase()),
  )

/** « Modifier le courriel de connexion » (only while no account exists). */
export const loginEmailSchema = z.object({ email: loginEmailField() })
export type LoginEmailValues = z.input<typeof loginEmailSchema>

/** Personal phone and home address. The province is required (the column is not null, default QC). */
export const contactSchema = z.object({
  personalPhone: optionalPhone(),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  province: z.enum(PROVINCES, { error: t('settings.validation.province') }),
  postalCode: optionalPostalCode(),
})
export type ContactValues = z.input<typeof contactSchema>

export function toContactFormValues(p: Professional): ContactValues {
  return {
    // Shown as typed in Québec (514 555-1234); the schema parses it back to E.164.
    personalPhone: formatPhone(p.personalPhone),
    addressLine1: p.addressLine1 ?? '',
    addressLine2: p.addressLine2 ?? '',
    city: p.city ?? '',
    province: p.province,
    postalCode: p.postalCode ?? '',
  }
}
