import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { scheduleLabel } from './schedule-label'

const NB = '\u00a0'

/** Pins the clock (Date only: nothing here waits on timers). */
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

afterEach(() => {
  vi.useRealTimers()
  resetClinicTimezone()
})

describe('scheduleLabel', () => {
  it('says « Toutes les heures » for a fixed minute of every hour', () => {
    expect(scheduleLabel('7 * * * *', null)).toBe('Toutes les heures')
  })

  it('says how many minutes for a step', () => {
    expect(scheduleLabel('*/5 * * * *', null)).toBe('Toutes les 5 minutes')
  })

  // The schedule is in UTC; the clinic hour follows daylight saving time, from today's date.
  it('shows a daily UTC time in clinic time, winter and summer', () => {
    at('2026-01-15T12:00:00Z')
    expect(scheduleLabel('30 8 * * *', null)).toBe(`Tous les jours à 3${NB}h${NB}30`)
    at('2026-07-15T12:00:00Z')
    expect(scheduleLabel('30 8 * * *', null)).toBe(`Tous les jours à 4${NB}h${NB}30`)
  })

  it('leaves out zero minutes', () => {
    at('2026-07-15T12:00:00Z')
    expect(scheduleLabel('0 11 * * *', null)).toBe(`Tous les jours à 7${NB}h`)
  })

  it('follows the clinic timezone setting', () => {
    at('2026-07-15T12:00:00Z')
    setClinicTimezone('America/Vancouver')
    expect(scheduleLabel('30 8 * * *', null)).toBe(`Tous les jours à 1${NB}h${NB}30`)
  })

  it('names a clinic-local hour as such, whatever the cron entry', () => {
    expect(scheduleLabel('0 * * * *', 6)).toBe(`Tous les jours à 6${NB}h (heure de la clinique)`)
    expect(scheduleLabel(null, 14)).toBe(`Tous les jours à 14${NB}h (heure de la clinique)`)
  })

  it('shows any other expression as is, and a job with no cron entry as not scheduled', () => {
    expect(scheduleLabel('0 8 * * 1', null)).toBe('Horaire personnalisé (0 8 * * 1)')
    expect(scheduleLabel('61 * * * *', null)).toBe('Horaire personnalisé (61 * * * *)')
    expect(scheduleLabel(null, null)).toBe('Non planifiée')
  })
})
