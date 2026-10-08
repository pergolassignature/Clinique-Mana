import { z } from 'zod'
import { t } from '@/i18n'
import { withoutControlChars } from '@/core/settings/organization/schemas'
import { EMAIL_PATTERN } from '@/shared/lib/email'
import type { BankDetails, BankDetailsInput } from './api'

/**
 * The bank details form. Mirrors `set_bank_details` (20261007205802_core_bank_details.sql): the
 * same patterns (digits as `[0-9]`, never `\d`) and the same French messages.
 */
const MESSAGES = {
  institution: t('settings.bank.validation.institution'),
  transit: t('settings.bank.validation.transit'),
  account: t('settings.bank.validation.account'),
  accountRequired: t('settings.bank.validation.accountRequired'),
  email: t('settings.bank.validation.email'),
} as const

const INSTITUTION = /^[0-9]{3}$/
const TRANSIT = /^[0-9]{5}$/
const ACCOUNT = /^[0-9]{7,12}$/
/** What the database strips from the account (`[ \t\r\n-]`): « 765-4321 » is 7654321. Nothing else is. */
const ACCOUNT_SEPARATORS = /[ \t\r\n-]/g

// A type alias (not an interface) so it satisfies useSettingsForm's FlatFormValues index signature.
export type BankFormValues = {
  institution: string
  transit: string
  /** Empty: keep the stored account (« Inchangé »), or an error when none is stored. */
  account: string
  etransferEmail: string
}

/**
 * `hasStoredAccount`: bank details exist, so an empty account keeps the stored one (null). On the
 * first save the account is required. Any character other than digits and the separators above is
 * an error, never removed (« 12a4567 » must not become a silent 124567 or a « keep »).
 */
export function bankDetailsSchema(hasStoredAccount: boolean): z.ZodType<BankDetailsInput, BankFormValues> {
  return z.object({
    institution: z.string().trim().regex(INSTITUTION, { error: MESSAGES.institution }),
    transit: z.string().trim().regex(TRANSIT, { error: MESSAGES.transit }),
    account: z.string().transform((v, ctx) => {
      const digits = v.replace(ACCOUNT_SEPARATORS, '')
      if (digits === '') {
        if (hasStoredAccount) return null
        ctx.addIssue({ code: 'custom', message: MESSAGES.accountRequired })
        return z.NEVER
      }
      if (!ACCOUNT.test(digits)) {
        ctx.addIssue({ code: 'custom', message: MESSAGES.account })
        return z.NEVER
      }
      return digits
    }),
    // Trimmed and lowercased as the database does; empty → null (no Interac email).
    etransferEmail: withoutControlChars(
      z
        .string()
        .transform((v) => v.toLowerCase())
        .refine((v) => v === '' || EMAIL_PATTERN.test(v), { error: MESSAGES.email })
        .transform((v) => (v === '' ? null : v)),
    ),
  })
}

/** The form's starting values: the stored numbers and email, never the account (left empty). */
export function toBankFormValues(details: BankDetails | null): BankFormValues {
  return {
    institution: details?.institution_number ?? '',
    transit: details?.transit_number ?? '',
    account: '',
    etransferEmail: details?.etransfer_email ?? '',
  }
}
