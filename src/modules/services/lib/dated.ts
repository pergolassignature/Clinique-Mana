import { lastDayOf, taxRateStatus } from '@/core/settings/tax/rates'
import { t } from '@/i18n'
import { formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'

/**
 * The rules of the module's dated rows (rate variants, billing policies), which follow
 * « Fiscalité »'s tax rates: `[effectiveFrom, effectiveTo)`, one open row per series, the last
 * row deletable while not in force yet or within 24 hours of its creation. Dates are date-only
 * `yyyy-MM-dd` strings, compared as strings, never through a timezone.
 */

export interface DatedRow {
  id: string
  effectiveFrom: string
  /** Exclusive; null while the row is open. */
  effectiveTo: string | null
  createdAt: string
}

export type DatedStatus = 'current' | 'upcoming' | 'ended'

/** Where a row stands on the clinic's `today`. */
export function datedStatus(row: Pick<DatedRow, 'effectiveFrom' | 'effectiveTo'>, today: string): DatedStatus {
  return taxRateStatus({ effective_from: row.effectiveFrom, effective_to: row.effectiveTo }, today)
}

/** The last day a closed row applies (the day before its exclusive end), or null while open. */
export const lastDay = (effectiveTo: string | null): string | null => lastDayOf(effectiveTo)

/** « Dès le 1 nov. 2026 » while open, « Du 1 juil. 2026 au 31 déc. 2026 » once closed (last day included). */
export function periodLabel(row: Pick<DatedRow, 'effectiveFrom' | 'effectiveTo'>): string {
  const from = formatDateOnlyShort(row.effectiveFrom)
  const end = lastDay(row.effectiveTo)
  return end === null ? t('modules.services.dated.since', { from }) : t('modules.services.dated.between', { from, to: formatDateOnlyShort(end) })
}

/**
 * The earliest start the `add_*` RPCs accept: the day after the open row's start; with no open
 * row, the series' last end (a row ended on a coming date: the next one starts on its end or
 * after); null for an empty series.
 */
export function earliestStart(rows: readonly DatedRow[]): string | null {
  const open = rows.find((row) => row.effectiveTo === null)
  if (open) return shiftCalendarDay(open.effectiveFrom, 1)
  const ends = rows.map((row) => row.effectiveTo).filter((end): end is string => end !== null)
  return ends.length === 0 ? null : ends.reduce((a, b) => (b > a ? b : a))
}

/** The rows of one series, newest start first. */
export function rowsOf<R extends DatedRow>(rows: readonly R[], keep: (row: R) => boolean): R[] {
  return rows.filter(keep).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
}

/** The correction window of the delete RPCs: a row created less than this long ago can go. */
const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether the database will let this row go (so « Supprimer » shows only there): the series' last
 * row (`series` newest first), not in force yet on `today`, or created less than 24 hours before
 * `now` (ms). `keepFirst`: the clinic's first billing policy stays. The database decides in the end.
 */
export function canDeleteDated(row: DatedRow, series: readonly DatedRow[], today: string, now: number, { keepFirst }: { keepFirst: boolean }): boolean {
  if (series.some((other) => other.effectiveFrom > row.effectiveFrom)) return false
  if (keepFirst && !series.some((other) => other.id !== row.id && other.effectiveTo === row.effectiveFrom)) return false
  if (row.effectiveFrom > today) return true
  const createdAt = Date.parse(row.createdAt)
  return !Number.isNaN(createdAt) && createdAt > now - CORRECTION_WINDOW_MS
}

/** The row in force on `today`, else the coming one, else null. */
export function shownRow<R extends DatedRow>(series: readonly R[], today: string): R | null {
  return series.find((row) => datedStatus(row, today) === 'current') ?? series.find((row) => row.effectiveTo === null) ?? null
}
