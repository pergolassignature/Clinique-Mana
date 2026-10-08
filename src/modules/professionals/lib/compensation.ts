import { lastDayOf, taxRateStatus } from '@/core/settings/tax/rates'
import { parseRate } from '@/shared/lib/format'
import { t } from '@/i18n'
import { formatDateOnly, formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'
import type { Duration, RetentionStatus } from '../api/compensation'

/**
 * Pure helpers of the retention program (P4-180…): percents, money and session counts as the
 * clinic reads and types them, months, and the rules of dated rows (grids, rates, decisions,
 * client agreements), which follow « Fiscalité »'s tax rates: `[effectiveFrom, effectiveTo)`, one
 * open row per series, the last row deletable while not in force yet or within 24 hours of its
 * creation (P4-145). Dates are date-only `yyyy-MM-dd` strings, compared as strings, never
 * through a timezone. Amounts are the database's: nothing here computes pay.
 */

/** A dated row of any compensation series. */
export interface DatedRow {
  id: string
  effectiveFrom: string
  /** Exclusive; null while the row is open (the series' last). */
  effectiveTo: string | null
  createdAt: string
}

export type DatedStatus = 'current' | 'upcoming' | 'ended'

/** Where a row stands on the clinic's `today` (same rule as the tax rates). */
export function datedStatus(row: Pick<DatedRow, 'effectiveFrom' | 'effectiveTo'>, today: string): DatedStatus {
  return taxRateStatus({ effective_from: row.effectiveFrom, effective_to: row.effectiveTo }, today)
}

/** The last day a closed row applies (the day before its exclusive end), or null while open. */
export const lastDay = (effectiveTo: string | null): string | null => lastDayOf(effectiveTo)

/** « Dès le 1 nov. 2026 » while open, « Du 1 janv. 2017 au 31 oct. 2026 » once closed (last day included). */
export function periodLabel(row: Pick<DatedRow, 'effectiveFrom' | 'effectiveTo'>): string {
  const from = formatDateOnlyShort(row.effectiveFrom)
  const end = lastDay(row.effectiveTo)
  return end === null
    ? t('modules.professionals.compensation.period.since', { from })
    : t('modules.professionals.compensation.period.between', { from, to: formatDateOnlyShort(end) })
}

/** The earliest start the `set_*` RPCs accept: the day after the open row's start; null without one. */
export function earliestStart(rows: readonly DatedRow[]): string | null {
  const open = rows.find((row) => row.effectiveTo === null)
  return open ? shiftCalendarDay(open.effectiveFrom, 1) : null
}

/** The rows of one key (a kind, a title), newest start first. */
export function rowsOf<R extends DatedRow>(rows: readonly R[], keep: (row: R) => boolean): R[] {
  return rows.filter(keep).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
}

/** The correction window of the delete RPCs: a row created less than this long ago can go. */
const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether the delete RPC will accept this row, so « Supprimer » shows only there: the series'
 * last row (`series` is newest first; the open one, or an ended agreement), not in force yet on
 * `today` or created less than 24 hours before `now` (ms). `keepFirst`: the clinic's other rates
 * keep their first row; grids, decisions and agreements do not. The database decides in the end.
 */
export function canDeleteDated(row: DatedRow, series: readonly DatedRow[], today: string, now: number, { keepFirst }: { keepFirst: boolean }): boolean {
  if (series.some((other) => other.effectiveFrom > row.effectiveFrom)) return false
  if (keepFirst && !series.some((other) => other.id !== row.id && other.effectiveTo === row.effectiveFrom)) return false
  if (row.effectiveFrom > today) return true
  const createdAt = Date.parse(row.createdAt)
  return !Number.isNaN(createdAt) && createdAt > now - CORRECTION_WINDOW_MS
}

// --- Percents (numeric(5, 2), 0–100) -----------------------------------------------------------------

const percentNumber = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 })

/** `28` → « 28 % », `27.5` → « 27,5 % » (a no-break space before the sign, as the tax rates). */
export function formatPercent(percent: number): string {
  return `${percentNumber.format(percent)}\u00A0%`
}

/**
 * A typed percent (`28`, `27,5`, `27,5 %`) → the stored value, rounded to 2 decimals as
 * `numeric(5, 2)`; null when it is not a non-negative number (the range is the schema's job).
 */
export function parsePercent(input: string): number | null {
  const fraction = parseRate(input)
  return fraction === null ? null : Math.round(fraction * 1e4) / 100
}

// --- Money (cents) ---------------------------------------------------------------------------------

const dollars = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `12688` → « 126,88 $ » (no-break space before the sign, as the percents). */
export function formatCents(cents: number): string {
  return `${dollars.format(cents / 100)}\u00A0$`
}

const DOLLARS_INPUT = /^(?:[0-9]+(?:[.,][0-9]{0,2})?|[.,][0-9]{1,2})$/

/** Typed dollars (`175`, `126,88`, `85.00 $`, `1 000`) → cents; null for anything else (a third decimal included). */
export function parseDollars(input: string): number | null {
  const compact = input.replace(/\s/g, '').replace(/\$$/, '')
  if (!DOLLARS_INPUT.test(compact)) return null
  return Math.round(Number(compact.replace(',', '.')) * 100)
}

// --- Sessions ------------------------------------------------------------------------------------------

const sessionsNumber = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 })

/** `55.5` → « 55,5 ». */
export const formatSessions = (sessions: number): string => sessionsNumber.format(sessions)

/** A month's count: a 50 or 60 minute session counts 1, a 30 minute one half (P4-186). */
export const monthCount = (long: number, short: number, adjustment = 0): number => long + short * 0.5 + adjustment

/** A typed count of sessions or an adjustment (`12`, `-3,5`): half steps; null for anything else. */
export function parseSessions(input: string, { signed, half }: { signed: boolean; half: boolean }): number | null {
  const compact = input.replace(/\s/g, '').replace(',', '.')
  const pattern = half ? (signed ? /^-?[0-9]+(?:\.[05])?$/ : /^[0-9]+(?:\.[05])?$/) : signed ? /^-?[0-9]+$/ : /^[0-9]+$/
  if (!pattern.test(compact)) return null
  const value = Number(compact)
  return Object.is(value, -0) ? 0 : value
}

/** The month rows with the cumulative total after each, oldest first then reversed (newest first). */
export function withRunningTotals<R extends { month: string; long: number; short: number; adjustment: number }>(rows: readonly R[]): (R & { total: number })[] {
  let total = 0
  return [...rows]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => {
      total += monthCount(row.long, row.short, row.adjustment)
      return { ...row, total }
    })
    .reverse()
}

// --- Months (`yyyy-MM-01`, date-only) -----------------------------------------------------------------

/** The first day of `date`'s month. */
export const monthOf = (date: string): string => `${date.slice(0, 7)}-01`

/** A month moved by `months` (negative: earlier). */
export function shiftMonth(month: string, months: number): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const index = year * 12 + (m - 1) + months
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

/** « octobre 2026 ». */
export const monthLabel = (month: string): string => formatDateOnly(month, 'MMMM yyyy')

// --- Labels ------------------------------------------------------------------------------------------

/** « 60 min / couple », « 50 min », « 30 min ». */
export const durationLabel = (duration: Duration): string => t(`modules.professionals.compensation.durations.${duration}`)

/**
 * The sheet's colour cues, on design-system tokens (P4-190): yellow for a gap, blue for the
 * floor, green for an increase decided for the month; plain otherwise.
 */
export type RetentionTone = 'warning' | 'info' | 'success' | 'default'
export function retentionTone(status: RetentionStatus, increaseDecided = false): RetentionTone {
  if (status === 'gap') return 'warning'
  if (increaseDecided) return 'success'
  if (status === 'floor') return 'info'
  return 'default'
}
