import { afterEach, describe, expect, it } from 'vitest'
import { resetClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { AUDIT_PERIODS, periodStart, periodStartOn } from './period'

afterEach(() => resetClinicTimezone())

describe('periodStart (America/Toronto)', () => {
  // 08:00 in the clinic (EDT, UTC−4).
  const now = new Date('2026-10-07T12:00:00Z')

  it('offers today, 7 days, 30 days and everything', () => {
    expect(AUDIT_PERIODS).toEqual(['today', '7d', '30d', 'all'])
  })

  it('starts « Aujourd’hui » at midnight in the clinic, as an instant', () => {
    expect(periodStart('today', now)).toBe('2026-10-07T04:00:00.000Z')
  })

  it('counts today in « 7 jours » and « 30 jours »', () => {
    expect(periodStart('7d', now)).toBe('2026-10-01T04:00:00.000Z')
    expect(periodStart('30d', now)).toBe('2026-09-08T04:00:00.000Z')
  })

  it('has no bound for « Tout »', () => {
    expect(periodStart('all', now)).toBeNull()
  })

  it('uses the clinic date, not the UTC date, late in the evening', () => {
    // 22:30 on 7 October in the clinic, already 8 October in UTC.
    expect(periodStart('today', new Date('2026-10-08T02:30:00Z'))).toBe('2026-10-07T04:00:00.000Z')
  })

  it('follows daylight saving: midnight before the change is EDT, after it EST', () => {
    // Sunday 1 November 2026: clocks go back at 02:00.
    const afterChange = new Date('2026-11-03T15:00:00Z')
    expect(periodStart('today', afterChange)).toBe('2026-11-03T05:00:00.000Z')
    expect(periodStart('7d', afterChange)).toBe('2026-10-28T04:00:00.000Z')
  })

  it('uses the configured clinic timezone', () => {
    setClinicTimezone('America/Vancouver')
    expect(periodStart('today', now)).toBe('2026-10-07T07:00:00.000Z')
  })

  it('also starts from a clinic date', () => {
    expect(periodStartOn('7d', '2026-10-07')).toBe('2026-10-01T04:00:00.000Z')
    expect(periodStartOn('all', '2026-10-07')).toBeNull()
  })
})
