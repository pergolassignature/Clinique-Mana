import { isValid, parseISO } from 'date-fns'
import { z } from 'zod'
import { t } from '@/i18n'
import { parseRate } from '@/shared/lib/format'
import { TAXES } from './api'

/** A date-only `yyyy-MM-dd` string (what `<input type="date">` gives). Digits as `[0-9]`, as in SQL. */
const DATE_ONLY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/** A `yyyy-MM-dd` string naming a real calendar day (parseISO refuses 2027-02-30). */
export const isCalendarDate = (v: string) => DATE_ONLY.test(v) && isValid(parseISO(v))

/**
 * « Nouveau taux »: a percentage typed in French (`9,975`) → the stored fraction, in the range
 * `add_tax_rate` accepts (0 % to less than 100 %); the start date stays a date-only string, sent
 * as is (never through a timezone).
 */
export const newTaxRateSchema = z.object({
  tax: z.enum(TAXES),
  rate: z.string().transform((v, ctx) => {
    const rate = parseRate(v)
    if (rate === null || rate >= 1) {
      ctx.addIssue({ code: 'custom', message: t('settings.tax.validation.rate') })
      return z.NEVER
    }
    return rate
  }),
  effective_from: z.string().trim().refine(isCalendarDate, { error: t('settings.tax.validation.date') }),
})
