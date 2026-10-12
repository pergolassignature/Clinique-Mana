import { z } from 'zod'
import { t } from '@/i18n'
import { formatDateOnlyShort, isCalendarDate, shiftCalendarDay } from '@/shared/lib/timezone'
import type { PolicyInput, VariantInput } from '../api/catalogue'
import { DISCOUNT_KINDS, FEE_MODES, RATE_VARIANTS, type DiscountKind, type FeeMode, type RateVariant } from '../lib/constants'
import { parseDollars, parsePercent } from '../lib/format'

/**
 * The dated dialogs (a student or reduced rate, a billing policy), mirroring the RPCs of
 * `*_services_module.sql`: amounts 0 $ to 10 000 $ in cents, percents 0,01–100 to two decimals,
 * dates that are real calendar days within 2000-01-01 … 2100-12-31, after the series' open row
 * (`minDate`, its day after). Dates stay the typed `yyyy-MM-dd` strings, never through a timezone.
 */

const V = 'modules.services.validation'

/** The bounds of `private.assert_services_start`, also the date inputs' `min` / `max`. */
export const FIRST_DATE = '2000-01-01'
export const LAST_DATE = '2100-12-31'

const calendarDate = z
  .string()
  .trim()
  .refine(isCalendarDate, { error: t(`${V}.date`), abort: true })
  .refine((v) => v >= FIRST_DATE && v <= LAST_DATE, { error: t(`${V}.dateBounds`) })

/** A start date strictly after the open row's (`minDate` is its day after), when there is one. */
function afterOpen(minDate: string | null) {
  return (values: { effectiveFrom: string }, ctx: z.RefinementCtx) => {
    if (minDate !== null && values.effectiveFrom < minDate) {
      ctx.addIssue({ code: 'custom', path: ['effectiveFrom'], message: t(`${V}.afterOpen`, { date: formatDateOnlyShort(shiftCalendarDay(minDate, -1)) }) })
    }
  }
}

// --- A student or reduced rate -------------------------------------------------------------------

export interface VariantFormValues {
  serviceId: string
  variant: RateVariant
  /** '' for every title. */
  titleId: string
  discountKind: DiscountKind
  /** Dollars for `price` and `amount`, a percent for `percent`. */
  value: string
  effectiveFrom: string
}

/** `minDateFor(serviceId, variant, titleId)`: the day after the series' open row, or null. */
export function variantSchema(minDateFor: (serviceId: string, variant: string, titleId: string | null) => string | null) {
  return z
    .object({
      serviceId: z.string().min(1, { error: t(`${V}.service`) }),
      variant: z.enum(RATE_VARIANTS, { error: t(`${V}.variant`) }),
      titleId: z.string(),
      discountKind: z.enum(DISCOUNT_KINDS, { error: t(`${V}.discountKind`) }),
      value: z.string(),
      effectiveFrom: calendarDate,
    })
    .superRefine((values, ctx) => {
      if (values.discountKind === 'percent') {
        const percent = parsePercent(values.value)
        if (percent === null || percent <= 0 || percent > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: t(`${V}.percent`) })
      } else {
        const cents = parseDollars(values.value)
        if (cents === null || cents > 1_000_000) ctx.addIssue({ code: 'custom', path: ['value'], message: t(`${V}.amount`) })
      }
      afterOpen(minDateFor(values.serviceId, values.variant, values.titleId === '' ? null : values.titleId))(values, ctx)
    })
    .transform(
      (values): VariantInput => ({
        serviceId: values.serviceId,
        variant: values.variant,
        titleId: values.titleId === '' ? null : values.titleId,
        discountKind: values.discountKind,
        amountCents: values.discountKind === 'percent' ? null : parseDollars(values.value),
        percent: values.discountKind === 'percent' ? parsePercent(values.value) : null,
        effectiveFrom: values.effectiveFrom,
      }),
    )
}

/** « Terminer » a rate: a last day strictly after its start, within the bounds. The RPC takes the exclusive end (the day after). */
export function endVariantSchema(effectiveFrom: string) {
  return z
    .object({ lastDay: calendarDate })
    .refine((values) => values.lastDay >= effectiveFrom, { path: ['lastDay'], error: t(`${V}.endAfterStart`, { date: formatDateOnlyShort(effectiveFrom) }) })
    .transform((values) => ({ effectiveTo: shiftCalendarDay(values.lastDay, 1) }))
}

// --- A billing policy ----------------------------------------------------------------------------

export interface PolicyFormValues {
  effectiveFrom: string
  lateNoticeHours: string
  firstFeePercent: string
  nextFeePercent: string
  /** '' for none. */
  fileOpeningServiceId: string
  feeMode: FeeMode
}

const percent = (message: string) =>
  z.string().transform((v, ctx) => {
    const value = parsePercent(v)
    if (value === null || value > 100) {
      ctx.addIssue({ code: 'custom', message })
      return z.NEVER
    }
    return value
  })

export function policySchema(minDate: string | null) {
  return z
    .object({
      effectiveFrom: calendarDate,
      lateNoticeHours: z.string().transform((v, ctx) => {
        const compact = v.replace(/\s/g, '')
        if (!/^[0-9]+$/.test(compact) || Number(compact) < 1 || Number(compact) > 168) {
          ctx.addIssue({ code: 'custom', message: t(`${V}.lateNotice`) })
          return z.NEVER
        }
        return Number(compact)
      }),
      firstFeePercent: percent(t(`${V}.feePercent`)),
      nextFeePercent: percent(t(`${V}.feePercent`)),
      fileOpeningServiceId: z.string(),
      feeMode: z.enum(FEE_MODES, { error: t(`${V}.feeMode`) }),
    })
    .superRefine(afterOpen(minDate))
    .transform(
      (values): PolicyInput => ({
        effectiveFrom: values.effectiveFrom,
        lateNoticeHours: values.lateNoticeHours,
        firstFeePercent: values.firstFeePercent,
        nextFeePercent: values.nextFeePercent,
        fileOpeningServiceId: values.fileOpeningServiceId === '' ? null : values.fileOpeningServiceId,
        feeMode: values.feeMode,
      }),
    )
}
