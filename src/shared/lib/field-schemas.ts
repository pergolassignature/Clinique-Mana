import { z } from 'zod'
import { t } from '@/i18n'
import { EMAIL_PATTERN } from '@/shared/lib/email'
import { formatPostalCode, parsePhone } from '@/shared/lib/format'

/**
 * Field schemas shared by the settings cards and the modules (Professionnels: identity, address,
 * contact). Forms work on strings; each schema trims, normalises and turns an empty value into null,
 * with the same patterns as the SQL checks (digits are `[0-9]`, never `\d`). The messages keep their
 * `settings.validation.*` keys: they were written for the settings cards and say nothing specific to them.
 */

const MESSAGES = {
  maxLength: (max: number) => t('settings.validation.maxLength', { max: String(max) }),
  province: t('settings.validation.province'),
  postalCode: t('settings.validation.postalCode'),
  phone: t('settings.validation.phone'),
  email: t('auth.errors.invalidEmail'),
  controlChar: t('settings.validation.controlChar'),
} as const

/** The 13 province and territory codes allowed by `organizations_province_check`. */
export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const
export type Province = (typeof PROVINCES)[number]

/** `A1A 1A1`, as stored (`formatPostalCode` puts the space back). */
const POSTAL_CODE = /^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$/

/**
 * C0 and C1 control characters. JS `\s` misses U+001C–U+001F and U+0085, which the database (ICU)
 * treats as whitespace, so the email and URL patterns would accept what the SQL check refuses.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

export const emptyToNull = <T>(v: T | '') => (v === '' ? null : v)

/** Required text: trimmed, at least one character (`requiredMessage`), at most `max`. */
export const requiredText = (max: number, requiredMessage: string) =>
  z.string().trim().min(1, { error: requiredMessage }).max(max, { error: MESSAGES.maxLength(max) })

/** Optional free text: trimmed, empty → null, at most `max` characters. */
export const optionalText = (max: number) => z.string().trim().max(max, { error: MESSAGES.maxLength(max) }).transform(emptyToNull)

/** Optional formatted value: trimmed, normalised, then empty → null or checked against `pattern`. */
export const optionalPattern = (pattern: RegExp, message: string, normalize: (v: string) => string = (v) => v) =>
  z
    .string()
    .transform((v) => normalize(v.trim()))
    .refine((v) => v === '' || pattern.test(v), { error: message })
    .transform(emptyToNull)

/**
 * Trims, then refuses control characters before anything else (abort: no second, misleading
 * format message). A pasted tab or line break at either end is trimmed, not refused.
 */
export const withoutControlChars = <T extends z.ZodType<unknown, string>>(schema: T) =>
  z.string().trim().refine((v) => !CONTROL_CHARS.test(v), { error: MESSAGES.controlChar, abort: true }).pipe(schema)

/** Optional email (EMAIL_PATTERN, the SQL checks' rule); control characters refused first. */
export const optionalEmail = () => withoutControlChars(optionalPattern(EMAIL_PATTERN, MESSAGES.email))

/** Optional phone, typed as in Quebec (`514 555-1234`, `1-514-…`, `+1 …`), stored in E.164 (`+15145551234`). */
export const optionalPhone = () =>
  z.string().transform((v, ctx) => {
    if (v.trim() === '') return null
    const parsed = parsePhone(v)
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: MESSAGES.phone })
      return z.NEVER
    }
    return parsed
  })

/** Optional Canadian postal code: any case, dash or no space typed, stored as `H2X 1Y4`. */
export const optionalPostalCode = () => optionalPattern(POSTAL_CODE, MESSAGES.postalCode, formatPostalCode)

/** Optional province or territory code. A string, not z.enum: the form's « no province » is '' (stored as null). */
export const optionalProvince = () =>
  z
    .string()
    .trim()
    .refine((v): v is Province | '' => v === '' || (PROVINCES as readonly string[]).includes(v), { error: MESSAGES.province })
    .transform(emptyToNull)
