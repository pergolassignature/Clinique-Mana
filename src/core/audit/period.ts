import { clinicTimeToUTC, getClinicDateString, shiftCalendarDay } from '@/shared/lib/timezone'

/** The « Période » filter: today, the last 7 or 30 days (today included), or everything. */
export const AUDIT_PERIODS = ['today', '7d', '30d', 'all'] as const
export type AuditPeriod = (typeof AUDIT_PERIODS)[number]

const PERIOD_DAYS: Record<Exclude<AuditPeriod, 'all'>, number> = { today: 1, '7d': 7, '30d': 30 }

/**
 * Where a period starts, as an instant for `list_audit_entries(p_from)`: midnight in the clinic's
 * timezone on the first day (today for « Aujourd'hui », 6 days ago for « 7 jours »). Null for
 * « Tout ». `p_from` is a timestamptz, so a clinic date is never sent as is.
 */
export function periodStart(period: AuditPeriod, now: Date = new Date()): string | null {
  return periodStartOn(period, getClinicDateString(now))
}

/** `periodStart` from the clinic's date (`yyyy-MM-dd`, e.g. `useClinicDate()`). */
export function periodStartOn(period: AuditPeriod, today: string): string | null {
  if (period === 'all') return null
  return clinicTimeToUTC(shiftCalendarDay(today, 1 - PERIOD_DAYS[period]), '00:00')
}
