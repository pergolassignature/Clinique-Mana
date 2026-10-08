import { useEffect, useState } from 'react'
import { clinicTimeToUTC, getClinicDateString } from './timezone'

/** A small margin past midnight, so the timer never fires on the last millisecond of the day. */
const MARGIN_MS = 1000

/** The day after `date` (`yyyy-MM-dd`), as a calendar date (computed in UTC: no timezone or DST shift). */
function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

/**
 * Today's date in the clinic's timezone (`yyyy-MM-dd`), updated at the clinic's next midnight: a
 * single timer per day instead of a tick every minute, so only what depends on the date re-renders.
 * A timer that fires early (or late, after the computer slept) reads the clock again.
 */
export function useClinicDate(): string {
  const [date, setDate] = useState(() => getClinicDateString(new Date()))
  // Bumped when the timer fired but the date had not changed yet, to schedule it again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const delay = Math.max(0, Date.parse(clinicTimeToUTC(nextDay(date), '00:00')) - Date.now()) + MARGIN_MS
    const id = setTimeout(() => {
      const today = getClinicDateString(new Date())
      if (today === date) setAttempt((n) => n + 1)
      else setDate(today)
    }, delay)
    return () => clearTimeout(id)
  }, [date, attempt])

  return date
}
