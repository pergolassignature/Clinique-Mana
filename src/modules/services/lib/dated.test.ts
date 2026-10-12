import { describe, expect, it } from 'vitest'
import { canDeleteDated, datedStatus, earliestStart, shownRow, type DatedRow } from './dated'

const row = (id: string, effectiveFrom: string, effectiveTo: string | null, createdAt = '2026-01-01T12:00:00Z'): DatedRow => ({ id, effectiveFrom, effectiveTo, createdAt })

describe('dated rows', () => {
  it('starts a new row the day after the open one, or on the last end when the series was ended', () => {
    expect(earliestStart([])).toBeNull()
    expect(earliestStart([row('a', '2026-01-01', '2026-07-01'), row('b', '2026-07-01', null)])).toBe('2026-07-02')
    // « Terminer » on a coming date: no open row; the next starts on that end or after (no overlap).
    expect(earliestStart([row('a', '2026-01-01', '2026-07-01'), row('b', '2026-07-01', '2027-01-01')])).toBe('2027-01-01')
  })

  it('says where a row stands and which one to show', () => {
    const series = [row('b', '2027-01-01', null), row('a', '2026-01-01', '2027-01-01')]
    expect(datedStatus(series[1] as DatedRow, '2026-10-12')).toBe('current')
    expect(datedStatus(series[0] as DatedRow, '2026-10-12')).toBe('upcoming')
    expect(datedStatus(series[1] as DatedRow, '2027-01-01')).toBe('ended')
    expect(shownRow(series, '2026-10-12')?.id).toBe('a')
    expect(shownRow([row('c', '2027-01-01', null)], '2026-10-12')?.id).toBe('c')
  })

  it('lets only the last row go, before it applies or within 24 hours', () => {
    const now = Date.parse('2026-10-12T12:00:00Z')
    const old = row('a', '2026-01-01', '2027-01-01')
    const coming = row('b', '2027-01-01', null)
    expect(canDeleteDated(old, [coming, old], '2026-10-12', now, { keepFirst: false })).toBe(false)
    expect(canDeleteDated(coming, [coming, old], '2026-10-12', now, { keepFirst: false })).toBe(true)
    const inForce = row('c', '2026-10-01', null, '2026-10-12T01:00:00Z')
    expect(canDeleteDated(inForce, [inForce], '2026-10-12', now, { keepFirst: false })).toBe(true)
    expect(canDeleteDated(inForce, [inForce], '2026-10-12', now + 24 * 3600_000, { keepFirst: false })).toBe(false)
    // The clinic's first policy stays.
    expect(canDeleteDated(coming, [coming], '2026-10-12', now, { keepFirst: true })).toBe(false)
  })
})
