import { lastDayOf, taxRateStatus } from '@/core/settings/tax/rates'
import { parseRate } from '@/shared/lib/format'
import { t } from '@/i18n'
import { formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'

/**
 * Pure helpers of the compensation terms (Task 4a.18): percents and money as the clinic reads and
 * types them, and the rules of dated rows (margins, default ranges, recognition levels and rules),
 * which follow « Fiscalité »'s tax rates: `[effectiveFrom, effectiveTo)`, one open row per series,
 * the open row deletable while not in force yet or within 24 hours of its creation (P4-145).
 * Dates are date-only `yyyy-MM-dd` strings, compared as strings, never through a timezone.
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

/** The rows of one kind (margins, default ranges), newest start first. */
export function rowsOfKind<R extends DatedRow & { kind: string }>(rows: readonly R[], kind: string): R[] {
  return rows.filter((row) => row.kind === kind).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
}

/** The correction window of the delete RPCs: a row created less than this long ago can go. */
const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether the delete RPC will accept this row, so « Supprimer » shows only there: the series' open
 * row, not in force yet on `today` or created less than 24 hours before `now` (ms). `keepFirst`: a
 * clinic's default ranges and rules keep their first row (a series is never left empty), a
 * professional's margins and levels do not (the default applies again). `series` is the row's own
 * series. The database decides in the end; a window closing while the page is open is refused there.
 */
export function canDeleteDated(row: DatedRow, series: readonly DatedRow[], today: string, now: number, { keepFirst }: { keepFirst: boolean }): boolean {
  if (row.effectiveTo !== null) return false
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

/** « 25–30 % », or « 25 % » when both bounds are equal. */
export function rangeLabel(min: number, max: number): string {
  return min === max ? formatPercent(min) : `${percentNumber.format(min)}–${percentNumber.format(max)}\u00A0%`
}

/**
 * A typed percent (`28`, `27,5`, `27,5 %`) → the stored value, rounded to 2 decimals as
 * `numeric(5, 2)`; null when it is not a non-negative number (the range is the schema's job).
 */
export function parsePercent(input: string): number | null {
  const fraction = parseRate(input)
  return fraction === null ? null : Math.round(fraction * 1e4) / 100
}

/** Outside the default range in force (bounds included); false when there is no range. */
export function isOutsideRange(percent: number, min: number | null, max: number | null): boolean {
  return min !== null && max !== null && (percent < min || percent > max)
}

// --- Money (the recognition bonuses, stored in cents) ---------------------------------------------

const dollars = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `50` → « 0,50 $ » (no-break space before the sign, as the percents). */
export function formatCents(cents: number): string {
  return `${dollars.format(cents / 100)}\u00A0$`
}

const DOLLARS_INPUT = /^(?:[0-9]+(?:[.,][0-9]{0,2})?|[.,][0-9]{1,2})$/

/** Typed dollars (`0,50`, `0.25 $`, `1`) → cents; null for anything else (a third decimal included). */
export function parseDollars(input: string): number | null {
  const compact = input.replace(/\s/g, '').replace(/\$$/, '')
  if (!DOLLARS_INPUT.test(compact)) return null
  return Math.round(Number(compact.replace(',', '.')) * 100)
}
