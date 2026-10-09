import { z } from 'zod'
import { t, type TranslationKey } from '@/i18n'
import { isCalendarDate } from '@/shared/lib/timezone'
import { formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'
import { DURATIONS, type AgreementInput, type Decision, type Duration, type GridInput, type RateInput } from '../api/compensation'
import { parseDollars, parsePercent, parseSessions } from '../lib/compensation'
import { tidyText } from './text'

/**
 * The retention dialogs (P4-180…), mirroring the RPCs of 20261008170703: percents 0–100 to two
 * decimals, sessions in whole numbers (adjustments in half sessions), money 0,01 $ to 1 000 $ in
 * cents, a one-line note of at most 500 characters, a client reference of at most 40, and dates
 * that are real calendar days within 2000-01-01 … 2100-12-31 (P4-150), after the series' open row
 * (`minDate`, its day after). Dates stay the typed `yyyy-MM-dd` strings: never through a timezone.
 * The database still decides; its refusals carry a HINT naming the field.
 */

const V = 'modules.professionals.compensation.validation'

/** The bounds of `private.assert_compensation_date` (P4-150), also the date inputs' `min` / `max`. */
export const FIRST_DATE = '2000-01-01'
export const LAST_DATE = '2100-12-31'

const calendarDate = z
  .string()
  .trim()
  .refine(isCalendarDate, { error: t(`${V}.date`), abort: true })
  .refine((v) => v >= FIRST_DATE && v <= LAST_DATE, { error: t(`${V}.dateBounds`) })

/** A start date strictly after the open row's (`minDate` is its day after), when there is one. */
function afterOpen(minDate: string | null, message: TranslationKey) {
  return (values: { effectiveFrom: string }, ctx: z.RefinementCtx) => {
    if (minDate !== null && values.effectiveFrom < minDate) {
      ctx.addIssue({ code: 'custom', path: ['effectiveFrom'], message: t(message, { date: formatDateOnlyShort(shiftCalendarDay(minDate, -1)) }) })
    }
  }
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

const money = (message: string) =>
  z.string().transform((v, ctx) => {
    const value = parseDollars(v)
    if (value === null || value < 1 || value > 100_000) {
      ctx.addIssue({ code: 'custom', message })
      return z.NEVER
    }
    return value
  })

const note = tidyText({ max: 500 })

// --- Sessions of a month ---------------------------------------------------------------------------

export type SessionsFormValues = { month: string; long: string; short: string; adjustment: string; note: string }
export interface SessionsInput {
  /** `yyyy-MM-01`. */
  month: string
  long: number
  short: number
  adjustment: number
  note: string | null
}

const count = (message: string) =>
  z.string().transform((v, ctx) => {
    const value = v.trim() === '' ? 0 : parseSessions(v, { signed: false, half: false })
    if (value === null || value > 2000) {
      ctx.addIssue({ code: 'custom', message })
      return z.NEVER
    }
    return value
  })

/** `currentMonth`: the clinic's month (`yyyy-MM-01`); a later month is refused, as the RPC does. */
export function sessionsSchema(currentMonth: string): z.ZodType<SessionsInput, SessionsFormValues> {
  return z.object({
    month: z
      .string()
      .trim()
      .refine((v) => /^[0-9]{4}-[0-9]{2}$/.test(v) && isCalendarDate(`${v}-01`), { error: t(`${V}.month`), abort: true })
      .transform((v) => `${v}-01`)
      .refine((v) => v >= FIRST_DATE && v <= currentMonth, { error: t(`${V}.monthFuture`) }),
    long: count(t(`${V}.sessionsLong`)),
    short: count(t(`${V}.sessionsShort`)),
    adjustment: z.string().transform((v, ctx) => {
      const value = v.trim() === '' ? 0 : parseSessions(v, { signed: true, half: true })
      if (value === null || Math.abs(value) > 100_000) {
        ctx.addIssue({ code: 'custom', message: t(`${V}.adjustment`) })
        return z.NEVER
      }
      return value
    }),
    note,
  })
}

// --- A decision on the applied rate --------------------------------------------------------------------

export type DecisionFormValues = { pct: string; effectiveFrom: string; note: string }
export interface DecisionFormOutput {
  pct: number | null
  effectiveFrom: string
  note: string | null
}

/** The rate is typed for `initial` and `custom` only; a custom rate needs its reason (P4-187). */
export function decisionSchema(decision: Decision, minDate: string | null): z.ZodType<DecisionFormOutput, DecisionFormValues> {
  const typed = decision === 'initial' || decision === 'custom'
  return z
    .object({
      pct: typed ? percent(t(`${V}.percent`)) : z.string().transform(() => null),
      effectiveFrom: calendarDate,
      note: decision === 'custom' ? tidyText({ max: 500, requiredMessage: t(`${V}.customNote`) }) : note,
    })
    .superRefine(afterOpen(minDate, `${V}.afterOpen.rate`))
}

// --- A client agreement ----------------------------------------------------------------------------------

export type AgreementFormValues = {
  clientLabel: string
  duration: string
  professionalAmount: string
  clientPrice: string
  effectiveFrom: string
  note: string
}

/**
 * A client reference that reads like a full name (P4-183, Loi 25): two or more words of letters
 * (two or more each; hyphens and apostrophes inside) and no digit, as
 * `set_professional_client_agreement` refuses it. « AB-123 », « M.T. », « D-1042 » pass.
 */
const FULL_NAME = /^\p{L}[\p{L}'’-]+(?:\s+\p{L}[\p{L}'’-]+)+$/u
export const looksLikeFullName = (label: string): boolean => !/[0-9]/.test(label) && FULL_NAME.test(label)

export function agreementSchema(): z.ZodType<AgreementInput, AgreementFormValues> {
  return z
    .object({
      clientLabel: tidyText({ max: 40, requiredMessage: t(`${V}.clientLabel`) }).refine((v) => !looksLikeFullName(v), { error: t(`${V}.clientLabelName`) }),
      duration: z
        .string()
        .refine((v) => (DURATIONS as readonly number[]).includes(Number(v)), { error: t(`${V}.duration`) })
        .transform((v) => Number(v) as Duration),
      professionalAmount: money(t(`${V}.money`)),
      clientPrice: money(t(`${V}.money`)),
      effectiveFrom: calendarDate,
      note,
    })
    .superRefine((values, ctx) => {
      if (values.professionalAmount > values.clientPrice) {
        ctx.addIssue({ code: 'custom', path: ['professionalAmount'], message: t(`${V}.amountAbovePrice`) })
      }
    })
    .transform((v) => ({
      clientLabel: v.clientLabel,
      duration: v.duration,
      professionalAmountCents: v.professionalAmount,
      clientPriceCents: v.clientPrice,
      effectiveFrom: v.effectiveFrom,
      note: v.note,
    }))
}

/**
 * An agreement's end: a real day after its start (`minDate` is the start's day after) and not
 * before the clinic's `today` (sessions already given keep their agreement), as the RPC checks.
 */
export function agreementEndSchema(minDate: string, today: string): z.ZodType<{ effectiveTo: string }, { effectiveTo: string }> {
  return z.object({ effectiveTo: calendarDate }).superRefine((values, ctx) => {
    if (values.effectiveTo < minDate) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: t(`${V}.endAfterStart`, { date: formatDateOnlyShort(shiftCalendarDay(minDate, -1)) }) })
    } else if (values.effectiveTo < today) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: t(`${V}.endBeforeToday`) })
    }
  })
}

// --- The clinic's other kinds' rates -------------------------------------------------------------------

export type RateFormValues = { kind: string; pct: string; effectiveFrom: string }

/** `minDateFor(kind)`: the earliest start for that kind (the day after its open rate), or null. */
export function rateSchema(minDateFor: (kind: string) => string | null): z.ZodType<RateInput, RateFormValues> {
  return z
    .object({ kind: z.string().refine((v) => v !== '', { error: t(`${V}.kind`) }), pct: percent(t(`${V}.percent`)), effectiveFrom: calendarDate })
    .superRefine((values, ctx) => afterOpen(minDateFor(values.kind), `${V}.afterOpen.rate`)(values, ctx))
}

// --- A grid version ----------------------------------------------------------------------------------------

export type GridFormValues = {
  effectiveFrom: string
  tiers: { threshold: string; pct: string }[]
  prices: Record<`${Duration}`, string>
  note: string
}

/**
 * A new version of a title's grid (P4-185): at least one tier, one at 0 sessions, whole distinct
 * thresholds, rates 0–100 that never rise with the threshold; at least one price, 0,01 $ to
 * 1 000 $ (a blank duration is not offered).
 */
export function gridSchema(titleId: string, minDate: string | null): z.ZodType<GridInput, GridFormValues> {
  return z
    .object({
      effectiveFrom: calendarDate,
      tiers: z
        .array(
          z.object({
            threshold: z.string().transform((v, ctx) => {
              const value = parseSessions(v, { signed: false, half: false })
              if (value === null || value > 100_000) {
                ctx.addIssue({ code: 'custom', message: t(`${V}.threshold`) })
                return z.NEVER
              }
              return value
            }),
            pct: percent(t(`${V}.percent`)),
          }),
        )
        .min(1, { error: t(`${V}.tiersRequired`) })
        .superRefine((tiers, ctx) => {
          const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold)
          if (new Set(tiers.map((tier) => tier.threshold)).size !== tiers.length) ctx.addIssue({ code: 'custom', message: t(`${V}.tiersDistinct`) })
          else if (sorted[0]?.threshold !== 0) ctx.addIssue({ code: 'custom', message: t(`${V}.tiersFromZero`) })
          else if (sorted.some((tier, i) => i > 0 && tier.pct > (sorted[i - 1]?.pct ?? Infinity))) ctx.addIssue({ code: 'custom', message: t(`${V}.tiersDecreasing`) })
        }),
      prices: z.object({ 60: z.string(), 50: z.string(), 30: z.string() }).transform((prices, ctx) => {
        const out: { duration: Duration; clientPriceCents: number }[] = []
        for (const duration of DURATIONS) {
          const typed = prices[duration].trim()
          if (typed === '') continue
          const cents = parseDollars(typed)
          if (cents === null || cents < 1 || cents > 100_000) {
            ctx.addIssue({ code: 'custom', path: [String(duration)], message: t(`${V}.money`) })
            return z.NEVER
          }
          out.push({ duration, clientPriceCents: cents })
        }
        if (out.length === 0) {
          ctx.addIssue({ code: 'custom', path: ['50'], message: t(`${V}.pricesRequired`) })
          return z.NEVER
        }
        return out
      }),
      note,
    })
    .superRefine(afterOpen(minDate, `${V}.afterOpen.grid`))
    .transform((v) => ({
      titleId,
      effectiveFrom: v.effectiveFrom,
      tiers: [...v.tiers].sort((a, b) => a.threshold - b.threshold),
      prices: v.prices,
      note: v.note,
    }))
}
