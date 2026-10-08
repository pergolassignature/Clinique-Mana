import { z } from 'zod'
import { t } from '@/i18n'
import { isCalendarDate } from '@/core/settings/tax/schemas'
import { formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'
import { CAP_BASES, type CapBasis, type DefaultRangeInput, type LevelInput, type MarginInput, type RecognitionRuleInput } from '../api/compensation'
import { parseDollars, parsePercent } from '../lib/compensation'
import { tidyText } from './text'

/**
 * The compensation dialogs (4a.18), mirroring 4a.17's RPCs: percents 0–100 to two decimals,
 * bonuses 0–100 $ (stored in cents), whole numbers in their bounds, a one-line note of at most
 * 500 characters, and a start date that is a real calendar day within 2000-01-01 … 2100-12-31
 * (P4-150), after the series' open row (`minDate`, its day after). The date stays the typed
 * `yyyy-MM-dd` string: never through a timezone. The database still decides (another person may
 * have added a row meanwhile); its date refusals carry HINT `effective_from`.
 */

const V = 'modules.professionals.compensation.validation'

/** The bounds of `private.assert_compensation_date`. */
const FIRST_DATE = '2000-01-01'
const LAST_DATE = '2100-12-31'

const effectiveFrom = z
  .string()
  .trim()
  .refine(isCalendarDate, { error: t(`${V}.date`), abort: true })
  .refine((v) => v >= FIRST_DATE && v <= LAST_DATE, { error: t(`${V}.dateBounds`) })

/** The open row's start is the day before `minDate`: the RPC wants the new row strictly later. */
type Series = 'margin' | 'range' | 'level' | 'rule'
function afterOpen(series: Series, minDate: string | null) {
  return (values: { effectiveFrom: string }, ctx: z.RefinementCtx) => {
    if (minDate !== null && values.effectiveFrom < minDate) {
      const date = formatDateOnlyShort(shiftCalendarDay(minDate, -1))
      ctx.addIssue({ code: 'custom', path: ['effectiveFrom'], message: t(`${V}.afterOpen.${series}`, { date }) })
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

const wholeNumber = (min: number, max: number, message: string) =>
  z.string().transform((v, ctx) => {
    const compact = v.replace(/\s/g, '')
    const value = /^[0-9]{1,7}$/.test(compact) ? Number(compact) : Number.NaN
    if (!(value >= min && value <= max)) {
      ctx.addIssue({ code: 'custom', message })
      return z.NEVER
    }
    return value
  })

const cents = z.string().transform((v, ctx) => {
  const value = parseDollars(v)
  if (value === null || value > 10_000) {
    ctx.addIssue({ code: 'custom', message: t(`${V}.bonus`) })
    return z.NEVER
  }
  return value
})

const note = tidyText({ max: 500 })
const kind = z.string().refine((v) => v !== '', { error: t(`${V}.kind`) })

// --- A professional's margin -------------------------------------------------------------------

export type MarginFormValues = { kind: string; marginPct: string; effectiveFrom: string; note: string }

/** `minDateFor(kind)`: the earliest start for that kind (the day after its open margin), or null. */
export function marginSchema(minDateFor: (kind: string) => string | null): z.ZodType<MarginInput, MarginFormValues> {
  return z
    .object({ kind, marginPct: percent(t(`${V}.percent`)), effectiveFrom, note })
    .superRefine((values, ctx) => afterOpen('margin', minDateFor(values.kind))(values, ctx))
}

// --- A professional's recognition level ---------------------------------------------------------

export type LevelFormValues = { level: string; sessions: string; effectiveFrom: string; note: string }

export function levelSchema(minDate: string | null): z.ZodType<LevelInput, LevelFormValues> {
  return z
    .object({
      level: wholeNumber(0, 1000, t(`${V}.level`)),
      sessions: wholeNumber(0, 100_000, t(`${V}.sessions`)),
      effectiveFrom,
      note,
    })
    .superRefine(afterOpen('level', minDate))
}

// --- The clinic's default range --------------------------------------------------------------------

export type DefaultRangeFormValues = { kind: string; min: string; max: string; effectiveFrom: string }

export function defaultRangeSchema(minDateFor: (kind: string) => string | null): z.ZodType<DefaultRangeInput, DefaultRangeFormValues> {
  return z
    .object({ kind, min: percent(t(`${V}.percent`)), max: percent(t(`${V}.percent`)), effectiveFrom })
    .superRefine((values, ctx) => {
      if (values.min > values.max) ctx.addIssue({ code: 'custom', path: ['max'], message: t(`${V}.minMax`) })
      afterOpen('range', minDateFor(values.kind))(values, ctx)
    })
}

// --- The clinic's recognition rule -------------------------------------------------------------------

export type RuleFormValues = {
  stepSessions: string
  bonusPer50Min: string
  bonusPer30Min: string
  capPct: string
  capBasis: string
  effectiveFrom: string
  note: string
}

const capBasis = z.enum(CAP_BASES)

export function ruleSchema(minDate: string | null): z.ZodType<RecognitionRuleInput, RuleFormValues> {
  return z
    .object({
      stepSessions: wholeNumber(1, 1000, t(`${V}.step`)),
      bonusPer50Min: cents,
      bonusPer30Min: cents,
      capPct: percent(t(`${V}.cap`)),
      capBasis: z.string().pipe(capBasis),
      effectiveFrom,
      note,
    })
    .superRefine(afterOpen('rule', minDate))
    .transform(({ bonusPer50Min, bonusPer30Min, capBasis: basis, ...rest }) => ({
      ...rest,
      bonusPer50MinCents: bonusPer50Min,
      bonusPer30MinCents: bonusPer30Min,
      capBasis: basis as CapBasis,
    }))
}
