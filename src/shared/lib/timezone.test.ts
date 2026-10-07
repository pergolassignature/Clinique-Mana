import { afterEach, describe, expect, it } from 'vitest'
import { formatClinicTime, formatDateOnly, getClinicTimezone, setClinicTimezone } from './timezone'

describe('clinic timezone', () => {
  afterEach(() => setClinicTimezone('America/Toronto'))

  it('defaults to America/Toronto', () => {
    expect(getClinicTimezone()).toBe('America/Toronto')
  })

  it('formats timestamps in the configured timezone', () => {
    const utc = '2026-01-15T19:30:00Z'
    expect(formatClinicTime(utc)).toBe('14:30')
    setClinicTimezone('America/Vancouver')
    expect(formatClinicTime(utc)).toBe('11:30')
  })

  it('never shifts date-only values', () => {
    setClinicTimezone('America/Vancouver')
    expect(formatDateOnly('2020-01-01')).toBe('1 janvier 2020')
  })
})
