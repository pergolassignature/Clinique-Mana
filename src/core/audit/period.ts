import { clinicTimeToUTC, getClinicDateString } from '@/shared/lib/timezone'

/** The « Période » filter: today, the last 7 or 30 days (today included), or everything. */
export const AUDIT_PERIODS = ['today', '7d', '30d', 'all'] as const
export type AuditPeriod = (typeof AUDIT_PERIODS)[number]

const PERIOD_DAYS: Record<Exclude<AuditPeriod, 'all'>, number> = { today: 1, '7d': 7, '30d': 30 }

/** `yyyy-MM-dd` ± days, as calendar dates (computed in UTC, so no timezone or DST shift). */
function shiftDay(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/**
 * Where a period starts, as an instant for `list_audit_entries(p_from)`: midnight in the clinic's
 * timezone on the first day (today for « Aujourd'hui », 6 days ago for « 7 jours »). Null for
 * « Tout ». `p_from` is a timestamptz, so a clinic date is never sent as is.
 */
export function periodStart(period: AuditPeriod, now: Date = new Date()): string | null {
  if (period === 'all') return null
  const firstDay = shiftDay(getClinicDateString(now), 1 - PERIOD_DAYS[period])
  return clinicTimeToUTC(firstDay, '00:00')
}
