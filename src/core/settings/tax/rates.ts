import { addDays, format, parseISO } from 'date-fns'
import type { TaxRate } from './api'

export type TaxRateStatus = 'current' | 'upcoming' | 'ended'

/** The correction window of `delete_tax_rate`: a rate created less than this long ago can be deleted. */
const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Where a rate stands on `today` (the clinic's date, `yyyy-MM-dd`). The end date is exclusive, so a
 * rate ending today has ended. Date-only strings compare as strings.
 */
export function taxRateStatus(rate: Pick<TaxRate, 'effective_from' | 'effective_to'>, today: string): TaxRateStatus {
  if (rate.effective_from > today) return 'upcoming'
  if (rate.effective_to !== null && rate.effective_to <= today) return 'ended'
  return 'current'
}

/**
 * The last day a rate applies: the day before its exclusive `effective_to` (« Le taux actuel se
 * terminera la veille de cette date »), or null while open. Calendar arithmetic on the date alone,
 * with no timezone.
 */
export function lastDayOf(effectiveTo: string | null): string | null {
  return effectiveTo === null ? null : shiftDay(effectiveTo, -1)
}

/**
 * The earliest start a new rate can have: the day after the open rate's start (`add_tax_rate`
 * wants it strictly later). Null when the tax has no open rate.
 */
export function earliestNewRateStart(rates: readonly TaxRate[]): string | null {
  const open = rates.find((rate) => rate.effective_to === null)
  return open ? shiftDay(open.effective_from, 1) : null
}

/** `yyyy-MM-dd` ± days, as calendar dates (parsed as local midnight, so no timezone or DST shift). */
function shiftDay(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd')
}

/**
 * Whether `delete_tax_rate` will accept this rate, so the page offers « Supprimer » only there:
 * - the tax's last (open) rate;
 * - not in force yet on `today` (clinic date), or created less than 24 hours before `now` (ms);
 * - not the tax's first rate: a previous rate must end exactly where this one starts.
 * `rates` is every rate loaded (any tax). The server decides in the end; a window that closes while
 * the page is open is refused there, with its French message.
 */
export function canDeleteTaxRate(rate: TaxRate, rates: readonly TaxRate[], today: string, now: number): boolean {
  if (rate.effective_to !== null) return false
  const hasPrevious = rates.some((r) => r.tax === rate.tax && r.id !== rate.id && r.effective_to === rate.effective_from)
  if (!hasPrevious) return false
  if (rate.effective_from > today) return true
  const createdAt = Date.parse(rate.created_at)
  return !Number.isNaN(createdAt) && createdAt > now - CORRECTION_WINDOW_MS
}
