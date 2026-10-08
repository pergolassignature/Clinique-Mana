import { describe, expect, it } from 'vitest'
import type { TaxRate } from './api'
import { canDeleteTaxRate, earliestNewRateStart, lastDayOf, taxRateStatus } from './rates'

const TODAY = '2026-10-07'
/** 2026-10-07 at noon UTC: « now » for the 24 h correction window. */
const NOW = Date.parse('2026-10-07T12:00:00Z')

const rate = (overrides: Partial<TaxRate>): TaxRate => ({
  id: 'r',
  tax: 'qst',
  rate: 0.09975,
  effective_from: '2013-01-01',
  effective_to: null,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('taxRateStatus', () => {
  it.each([
    ['open and started', '2013-01-01', null, 'current'],
    ['starting today', TODAY, null, 'current'],
    ['starting tomorrow', '2026-10-08', null, 'upcoming'],
    ['ending tomorrow (its last day is today)', '2013-01-01', '2026-10-08', 'current'],
    ['ending today (its last day was yesterday)', '2013-01-01', TODAY, 'ended'],
    ['ended long ago', '2008-01-01', '2013-01-01', 'ended'],
  ] as const)('%s → %s', (_case, effective_from, effective_to, status) => {
    expect(taxRateStatus(rate({ effective_from, effective_to }), TODAY)).toBe(status)
  })
})

describe('lastDayOf', () => {
  it('is the day before the exclusive end date, across months, years and leap days', () => {
    expect(lastDayOf('2027-01-01')).toBe('2026-12-31')
    expect(lastDayOf('2024-03-01')).toBe('2024-02-29')
    expect(lastDayOf('2026-10-08')).toBe('2026-10-07')
  })

  it('is null for an open rate', () => {
    expect(lastDayOf(null)).toBeNull()
  })

  it('is not shifted by the end of daylight saving time (2026-11-01)', () => {
    expect(lastDayOf('2026-11-02')).toBe('2026-11-01')
    expect(lastDayOf('2026-03-09')).toBe('2026-03-08')
  })
})

describe('earliestNewRateStart', () => {
  it("is the day after the open rate's start", () => {
    const ended = rate({ id: 'a', effective_from: '2012-01-01', effective_to: '2013-01-01' })
    const open = rate({ id: 'b', effective_from: '2026-12-31', effective_to: null })
    expect(earliestNewRateStart([open, ended])).toBe('2027-01-01')
  })

  it('is null without an open rate', () => {
    expect(earliestNewRateStart([])).toBeNull()
  })
})

describe('canDeleteTaxRate', () => {
  const first = rate({ id: 'first', effective_from: '2013-01-01', effective_to: '2027-01-01' })
  const upcoming = rate({ id: 'next', rate: 0.1, effective_from: '2027-01-01', effective_to: null, created_at: '2026-09-01T00:00:00Z' })

  it('allows the open rate that is not in force yet', () => {
    expect(canDeleteTaxRate(upcoming, [upcoming, first], TODAY, NOW)).toBe(true)
  })

  it('allows the open rate created less than 24 hours ago, even in force (correction window)', () => {
    const closed = rate({ id: 'first', effective_to: '2026-09-01' })
    const backdated = rate({ id: 'fix', rate: 0.1, effective_from: '2026-09-01', created_at: '2026-10-06T12:00:01Z' })
    expect(canDeleteTaxRate(backdated, [backdated, closed], TODAY, NOW)).toBe(true)
  })

  it('refuses an open rate in force created 24 hours ago or more', () => {
    const closed = rate({ id: 'first', effective_to: '2026-09-01' })
    const old = rate({ id: 'old', rate: 0.1, effective_from: '2026-09-01', created_at: '2026-10-06T12:00:00Z' })
    expect(canDeleteTaxRate(old, [old, closed], TODAY, NOW)).toBe(false)
  })

  it('refuses a rate that has ended (only the last one can go)', () => {
    expect(canDeleteTaxRate(first, [upcoming, first], TODAY, NOW)).toBe(false)
  })

  it("refuses a tax's first rate, even fresh or upcoming: nothing would be left to reopen", () => {
    const seeded = rate({ id: 'seeded', created_at: '2026-10-07T11:00:00Z' })
    const future = rate({ id: 'future', effective_from: '2027-01-01' })
    expect(canDeleteTaxRate(seeded, [seeded], TODAY, NOW)).toBe(false)
    expect(canDeleteTaxRate(future, [future], TODAY, NOW)).toBe(false)
  })

  it('only counts the previous rate of the same tax', () => {
    const gst = rate({ id: 'gst', tax: 'gst', effective_from: '2008-01-01', effective_to: '2027-01-01' })
    expect(canDeleteTaxRate(upcoming, [upcoming, gst], TODAY, NOW)).toBe(false)
  })

  it('refuses a rate whose creation time cannot be read, unless it is upcoming', () => {
    const closed = rate({ id: 'first', effective_to: '2026-09-01' })
    const unknown = rate({ id: 'x', effective_from: '2026-09-01', created_at: 'not a date' })
    expect(canDeleteTaxRate(unknown, [unknown, closed], TODAY, NOW)).toBe(false)
  })
})
