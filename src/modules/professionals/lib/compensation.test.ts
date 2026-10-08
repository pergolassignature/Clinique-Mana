import { describe, expect, it } from 'vitest'
import {
  canDeleteDated,
  datedStatus,
  earliestStart,
  formatCents,
  formatPercent,
  isOutsideRange,
  parseDollars,
  parsePercent,
  periodLabel,
  rangeLabel,
  rowsOfKind,
  type DatedRow,
} from './compensation'

const NBSP = '\u00A0'
const NOW = Date.parse('2026-10-08T16:00:00Z')
const TODAY = '2026-10-08'

const row = (id: string, effectiveFrom: string, effectiveTo: string | null, createdAt = '2026-01-01T00:00:00Z'): DatedRow => ({
  id,
  effectiveFrom,
  effectiveTo,
  createdAt,
})

describe('percent and money', () => {
  it('formats a stored percent the French way', () => {
    expect(formatPercent(28)).toBe(`28${NBSP}%`)
    expect(formatPercent(27.5)).toBe(`27,5${NBSP}%`)
    expect(formatPercent(0)).toBe(`0${NBSP}%`)
  })

  it('reads a typed percent to two decimals, refusing anything else', () => {
    expect(parsePercent('28')).toBe(28)
    expect(parsePercent('27,5 %')).toBe(27.5)
    expect(parsePercent('33.333')).toBe(33.33)
    expect(parsePercent('')).toBeNull()
    expect(parsePercent('-1')).toBeNull()
    expect(parsePercent('abc')).toBeNull()
  })

  it('formats cents as dollars and reads typed dollars as cents', () => {
    expect(formatCents(50)).toBe(`0,50${NBSP}$`)
    expect(formatCents(1250)).toBe(`12,50${NBSP}$`)
    expect(parseDollars('0,50')).toBe(50)
    expect(parseDollars('0.25 $')).toBe(25)
    expect(parseDollars('1')).toBe(100)
    expect(parseDollars('0,505')).toBeNull()
    expect(parseDollars('x')).toBeNull()
  })

  it('names a range, one value when its bounds are equal', () => {
    expect(rangeLabel(25, 30)).toBe(`25–30${NBSP}%`)
    expect(rangeLabel(25, 25)).toBe(`25${NBSP}%`)
  })

  it('flags a margin outside its default range (bounds included)', () => {
    expect(isOutsideRange(35, 25, 30)).toBe(true)
    expect(isOutsideRange(24.99, 25, 30)).toBe(true)
    expect(isOutsideRange(25, 25, 30)).toBe(false)
    expect(isOutsideRange(30, 25, 30)).toBe(false)
    expect(isOutsideRange(35, null, null)).toBe(false)
  })
})

describe('dated rows', () => {
  it('reads a row as current, upcoming or ended on the clinic date (end exclusive)', () => {
    expect(datedStatus(row('a', '2026-10-08', null), TODAY)).toBe('current')
    expect(datedStatus(row('a', '2026-10-09', null), TODAY)).toBe('upcoming')
    expect(datedStatus(row('a', '2026-01-01', '2026-10-08'), TODAY)).toBe('ended')
  })

  it('reads a period with its last day included, as date-only strings', () => {
    expect(periodLabel(row('a', '2026-11-01', null))).toBe('Dès le 1 nov. 2026')
    expect(periodLabel(row('a', '2017-01-01', '2026-11-01'))).toBe('Du 1 janv. 2017 au 31 oct. 2026')
  })

  it('starts a new row the day after the open one', () => {
    expect(earliestStart([row('old', '2025-01-01', '2026-01-01'), row('open', '2026-01-01', null)])).toBe('2026-01-02')
    expect(earliestStart([])).toBeNull()
  })

  it('lists the rows of one kind, newest start first', () => {
    const rows = [
      { ...row('a', '2025-01-01', '2026-01-01'), kind: 'consultation' },
      { ...row('b', '2026-01-01', null), kind: 'consultation' },
      { ...row('c', '2026-03-01', null), kind: 'workshop' },
    ]
    expect(rowsOfKind(rows, 'consultation').map((r) => r.id)).toEqual(['b', 'a'])
  })

  describe('canDeleteDated (the delete RPCs’ rule, P4-145)', () => {
    const previous = row('prev', '2017-01-01', '2026-11-01')
    it('allows the open row while it is not in force yet', () => {
      const open = row('open', '2026-11-01', null)
      expect(canDeleteDated(open, [previous, open], TODAY, NOW, { keepFirst: true })).toBe(true)
    })

    it('allows the open row in force when created less than 24 hours ago, not after', () => {
      const fresh = row('open', '2026-10-01', null, '2026-10-07T17:00:00Z')
      const old = row('open', '2026-10-01', null, '2026-10-07T15:59:59Z')
      const prev = row('prev', '2017-01-01', '2026-10-01')
      expect(canDeleteDated(fresh, [prev, fresh], TODAY, NOW, { keepFirst: true })).toBe(true)
      expect(canDeleteDated(old, [prev, old], TODAY, NOW, { keepFirst: true })).toBe(false)
    })

    it('never allows a closed row', () => {
      expect(canDeleteDated(previous, [previous], TODAY, NOW, { keepFirst: false })).toBe(false)
    })

    it('keeps the first row of a clinic list, lets a professional’s first one go', () => {
      const only = row('only', '2026-11-01', null)
      expect(canDeleteDated(only, [only], TODAY, NOW, { keepFirst: true })).toBe(false)
      expect(canDeleteDated(only, [only], TODAY, NOW, { keepFirst: false })).toBe(true)
    })
  })
})
