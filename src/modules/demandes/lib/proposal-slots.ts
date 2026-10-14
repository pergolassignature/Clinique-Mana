import { formatInClinicTimezone } from '@/shared/lib/timezone'

/** The moments of a day a slot falls in (D-49, « déléguée — révisable »): the request's periods. */
export type DayPeriod = 'am' | 'pm' | 'end_of_day' | 'evening'

/**
 * A slot's moment in the clinic's day: Matin before 12:00, Après-midi 12:00–16:00, Fin de journée
 * 16:00–18:00, Soir from 18:00; and whether it falls on the weekend (Saturday, Sunday).
 */
export function slotPeriod(startsAt: string): { period: DayPeriod; weekend: boolean } {
  const hour = Number(formatInClinicTimezone(startsAt, 'H'))
  const isoDay = Number(formatInClinicTimezone(startsAt, 'i'))
  const period: DayPeriod = hour < 12 ? 'am' : hour < 16 ? 'pm' : hour < 18 ? 'end_of_day' : 'evening'
  return { period, weekend: isoDay >= 6 }
}

/**
 * Whether a slot suits the periods the person gave: on a weekend, « Fin de semaine » (any time);
 * on a weekday, one of the day's moments. No periods given: every slot suits.
 */
export function suitsPeriods(startsAt: string, periods: readonly string[]): boolean {
  if (periods.length === 0) return true
  const { period, weekend } = slotPeriod(startsAt)
  return weekend ? periods.includes('weekend') : periods.includes(period)
}

/**
 * The service a proposal starts with (D-48, as the matching panel's next slot): a couple's service
 * for a couple, else the 50-minute session, else the first offered. Null when none is offered.
 */
export function defaultServiceId(
  services: readonly { id: string; duration_minutes: number; for_two: boolean }[],
  forTwo: boolean,
): string | null {
  const ranked = [...services].sort(
    (a, b) => Number(b.for_two === forTwo) - Number(a.for_two === forTwo) || Number(b.duration_minutes === 50) - Number(a.duration_minutes === 50),
  )
  return ranked[0]?.id ?? null
}
