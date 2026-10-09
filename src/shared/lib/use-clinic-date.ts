import { useEffect, useState } from 'react'
import { clinicTimeToUTC, getClinicDateString, getClinicTimezone, shiftCalendarDay } from './timezone'

/** A small margin past midnight, so the timer never fires on the last millisecond of the day. */
const MARGIN_MS = 1000

/**
 * Today's date in the clinic's timezone (`yyyy-MM-dd`), updated at the clinic's next midnight: a
 * single timer per day instead of a tick every minute, so only what depends on the date re-renders.
 * A timer that fires early (or late, after the computer slept) reads the clock again.
 */
export function useClinicDate(): string {
  const [date, setDate] = useState(() => getClinicDateString(new Date()))
  // Bumped when the timer fired but the date had not changed yet, to schedule it again.
  const [attempt, setAttempt] = useState(0)
  // The zone the date was read in: a « Région » change re-reads it on the next render (the shell
  // also remounts on it, AuthenticatedApp; this keeps the hook right wherever it is used).
  const [zone, setZone] = useState(getClinicTimezone)
  const currentZone = getClinicTimezone()
  if (zone !== currentZone) {
    setZone(currentZone)
    setDate(getClinicDateString(new Date()))
  }

  useEffect(() => {
    const delay = Math.max(0, Date.parse(clinicTimeToUTC(shiftCalendarDay(date, 1), '00:00')) - Date.now()) + MARGIN_MS
    const id = setTimeout(() => {
      const today = getClinicDateString(new Date())
      if (today === date) setAttempt((n) => n + 1)
      else setDate(today)
    }, delay)
    return () => clearTimeout(id)
  }, [date, attempt, zone])

  return date
}
