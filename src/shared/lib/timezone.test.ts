import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clinicTimeToUTC,
  formatClinicDateShort,
  formatClinicTime,
  formatDateOnly,
  formatInClinicTimezone,
  isCalendarDate,
  getClinicTimezone,
  isClinicToday,
  resetClinicTimezone,
  setClinicTimezone,
  shiftCalendarDay,
} from './timezone'
import * as clinicTimezone from './clinic-timezone'

describe('clinic timezone', () => {
  afterEach(() => {
    resetClinicTimezone()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('runs tests with a host timezone different from the clinic', () => {
    // Pinned in vitest.config.ts so date-only tests prove there is no host shift.
    expect(new Date('2020-01-01T12:00:00Z').getTimezoneOffset()).toBe(480)
  })

  // AccessProvider sets it through ./clinic-timezone (no date-fns on the login page).
  it('shares one setting with the date-fns-free clinic-timezone module', () => {
    clinicTimezone.setClinicTimezone('America/Vancouver')
    expect(getClinicTimezone()).toBe('America/Vancouver')
    expect(formatInClinicTimezone('2026-01-21T20:00:00Z', 'HH:mm')).toBe('12:00')
    resetClinicTimezone()
    expect(clinicTimezone.getClinicTimezone()).toBe('America/Toronto')
  })

  it('defaults to America/Toronto', () => {
    expect(getClinicTimezone()).toBe('America/Toronto')
  })

  it('formats timestamps in the configured timezone', () => {
    const utc = '2026-01-15T19:30:00Z'
    expect(formatClinicTime(utc)).toBe('14:30')
    setClinicTimezone('America/Vancouver')
    expect(formatClinicTime(utc)).toBe('11:30')
  })

  it('ignores an invalid timezone and keeps the current one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setClinicTimezone('America/Vancouver')
    setClinicTimezone('Not/AZone')
    expect(getClinicTimezone()).toBe('America/Vancouver')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns only once when the same invalid timezone is requested repeatedly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setClinicTimezone('Not/AZone')
    setClinicTimezone('Not/AZone')
    setClinicTimezone('Not/AZone')
    expect(warn).toHaveBeenCalledOnce()
    expect(getClinicTimezone()).toBe('America/Toronto')
  })

  it('applies a timezone again after a reset', () => {
    setClinicTimezone('America/Vancouver')
    resetClinicTimezone()
    setClinicTimezone('America/Vancouver')
    expect(getClinicTimezone()).toBe('America/Vancouver')
  })

  it('resets to America/Toronto', () => {
    setClinicTimezone('America/Vancouver')
    resetClinicTimezone()
    expect(getClinicTimezone()).toBe('America/Toronto')
  })

  it('returns an em dash for missing or invalid timestamps', () => {
    expect(formatClinicTime(null)).toBe('—')
    expect(formatClinicDateShort(undefined)).toBe('—')
    expect(formatInClinicTimezone('not a date', 'HH:mm')).toBe('—')
  })

  it('knows what "today" and "now" are in the clinic timezone', () => {
    vi.useFakeTimers()
    // 03:00 UTC on Jan 16 = 22:00 on Jan 15 in Toronto (19:00 in the Vancouver host).
    vi.setSystemTime(new Date('2026-01-16T03:00:00Z'))
    expect(isClinicToday('2026-01-15T15:00:00Z')).toBe(true)
    expect(isClinicToday('2026-01-16T06:00:00Z')).toBe(false)
    expect(isClinicToday(null)).toBe(false)
  })

  it('converts clinic wall time to UTC regardless of the host timezone', () => {
    expect(clinicTimeToUTC('2026-07-01', '14:30')).toBe('2026-07-01T18:30:00.000Z')
    expect(clinicTimeToUTC('2026-07-01', '14:30:00')).toBe('2026-07-01T18:30:00.000Z')
    expect(clinicTimeToUTC('2026-01-15', '14:30')).toBe('2026-01-15T19:30:00.000Z')
  })

  it('never shifts date-only values', () => {
    setClinicTimezone('America/Vancouver')
    expect(formatDateOnly('2020-01-01')).toBe('1 janvier 2020')
    expect(formatDateOnly('2020-01-01T00:00:00Z')).toBe('1 janvier 2020')
    expect(formatDateOnly('2020-01-01 00:00:00+00')).toBe('1 janvier 2020')
    expect(formatDateOnly(null)).toBe('—')
  })
})

describe('shiftCalendarDay', () => {
  it('moves a date-only string by whole calendar days, across months, years and leap days', () => {
    expect(shiftCalendarDay('2026-10-08', 1)).toBe('2026-10-09')
    expect(shiftCalendarDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftCalendarDay('2028-03-01', -1)).toBe('2028-02-29')
    expect(shiftCalendarDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftCalendarDay('2026-10-08', -29)).toBe('2026-09-09')
    expect(shiftCalendarDay('2026-10-08', 0)).toBe('2026-10-08')
  })

  it('is not shifted by a DST change (host in America/Vancouver for the tests)', () => {
    expect(shiftCalendarDay('2026-03-08', 1)).toBe('2026-03-09')
    expect(shiftCalendarDay('2026-11-01', 1)).toBe('2026-11-02')
    expect(shiftCalendarDay('2026-11-02', -1)).toBe('2026-11-01')
  })
})

describe('isCalendarDate', () => {
  it('accepts a real yyyy-MM-dd day, leap days included', () => {
    expect(isCalendarDate('2027-01-01')).toBe(true)
    expect(isCalendarDate('2028-02-29')).toBe(true)
  })

  it.each(['', '2027-02-29', '2027-02-30', '2027-13-01', '2027-1-01', '01/01/2027', '2027-01-01T00:00'])('refuses « %s »', (v) => {
    expect(isCalendarDate(v)).toBe(false)
  })
})
