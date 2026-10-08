import { describe, expect, it } from 'vitest'
import {
  canDeleteDated,
  datedStatus,
  decisionActionLabel,
  decisionTitle,
  earliestStart,
  formatCents,
  formatPercent,
  formatSessions,
  monthCount,
  monthLabel,
  monthOf,
  parseDollars,
  parsePercent,
  parseSessions,
  payChanges,
  percentInput,
  periodLabel,
  retentionDisplay,
  retentionTone,
  rowsOf,
  sessionsLabel,
  shiftMonth,
  tierRangeLabel,
  tierShortLabel,
  withRunningTotals,
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

  it('formats cents of client prices and pay', () => {
    expect(formatCents(12688)).toBe(`126,88${NBSP}$`)
    expect(parseDollars('175')).toBe(17500)
    expect(parseDollars('126,88 $')).toBe(12688)
  })
})

describe('sessions and months', () => {
  it('counts a 30-minute session as half (P4-186)', () => {
    expect(monthCount(20, 4)).toBe(22)
    expect(monthCount(0, 0, 33.5)).toBe(33.5)
  })

  it('reads typed counts: whole, or by half sessions for an adjustment', () => {
    expect(parseSessions('12', { signed: false, half: false })).toBe(12)
    expect(parseSessions('12,5', { signed: false, half: false })).toBeNull()
    expect(parseSessions('237,5', { signed: true, half: true })).toBe(237.5)
    expect(parseSessions('-3', { signed: true, half: true })).toBe(-3)
    expect(parseSessions('-3', { signed: false, half: true })).toBeNull()
    expect(parseSessions('0,3', { signed: true, half: true })).toBeNull()
    expect(parseSessions('-0', { signed: true, half: true })).toBe(0)
  })

  it('formats counts the French way', () => {
    expect(formatSessions(55.5)).toBe('55,5')
    expect(formatSessions(312)).toBe('312')
  })

  it('gives each month the cumulative total after it, newest first', () => {
    const rows = [
      { month: '2026-09-01', long: 20, short: 4, adjustment: 0 },
      { month: '2026-07-01', long: 0, short: 0, adjustment: 33.5 },
    ]
    expect(withRunningTotals(rows).map((r) => [r.month, r.total])).toEqual([
      ['2026-09-01', 55.5],
      ['2026-07-01', 33.5],
    ])
  })

  it('moves and names months as calendar months (no timezone)', () => {
    expect(monthOf('2026-10-08')).toBe('2026-10-01')
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01')
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01')
    expect(monthLabel('2026-10-01')).toBe('octobre 2026')
  })
})

describe('tiers and counts as the clinic reads them', () => {
  it('keeps « séance » singular below 2', () => {
    expect(sessionsLabel(0)).toBe('0 séance')
    expect(sessionsLabel(1)).toBe('1 séance')
    expect(sessionsLabel(1.5)).toBe('1,5 séance')
    expect(sessionsLabel(2)).toBe('2 séances')
    expect(sessionsLabel(237.5)).toBe('237,5 séances')
  })

  it('reads a tier as the sheet’s range in whole sessions (P4-198)', () => {
    expect(tierRangeLabel(0, 51)).toBe('0 à 50 séances')
    expect(tierRangeLabel(51, 101)).toBe('51 à 100 séances')
    expect(tierRangeLabel(501, null)).toBe('501 séances et plus')
    expect(tierRangeLabel(0, 2)).toBe('0 à 1 séance')
    expect(tierShortLabel(101, 151)).toBe('101–150')
    expect(tierShortLabel(501, null)).toBe('501 et +')
  })

  it('puts a stored percent back in a rate field', () => {
    expect(percentInput(27.5)).toBe('27,5')
    expect(percentInput(28)).toBe('28')
    expect(parsePercent(percentInput(26.25))).toBe(26.25)
  })
})

describe('statuses as plain sentences (P4-197)', () => {
  const applied = (pct: number, tierThreshold: number | null) => ({ pct, tierThreshold })
  it('splits a gap: a new tier reached, or a rate that differs from the grid', () => {
    expect(retentionDisplay({ status: 'gap', applied: applied(27.5, 101), suggested: { threshold: 101, pct: 27 } })).toBe('newTier')
    expect(retentionDisplay({ status: 'gap', applied: applied(27, 51), suggested: { threshold: 101, pct: 27 } })).toBe('newTier')
    expect(retentionDisplay({ status: 'gap', applied: applied(26, null), suggested: { threshold: 0, pct: 30 } })).toBe('gridGap')
  })

  it('names a missing starting rate, a decided increase and the others', () => {
    expect(retentionDisplay({ status: 'no_rate', applied: null, suggested: { threshold: 0, pct: 30 } })).toBe('noRate')
    expect(retentionDisplay({ status: 'conforme', applied: applied(28.5, 151), suggested: { threshold: 151, pct: 28.5 } }, true)).toBe('increaseDecided')
    expect(retentionDisplay({ status: 'floor', applied: applied(25, 301), suggested: { threshold: 301, pct: 25 } })).toBe('floor')
    expect(retentionDisplay({ status: 'profession_unconfirmed', applied: null, suggested: null })).toBe('professionUnconfirmed')
  })

  it('yellow for a gap, green for a decided increase, blue for the floor, plain otherwise (P4-190)', () => {
    expect(retentionTone('newTier')).toBe('warning')
    expect(retentionTone('gridGap')).toBe('warning')
    expect(retentionTone('increaseDecided')).toBe('success')
    expect(retentionTone('floor')).toBe('info')
    expect(retentionTone('noRate')).toBe('default')
    expect(retentionTone('maintained')).toBe('default')
  })
})

describe('decisions that say what they do (P4-197, P4-198)', () => {
  it('puts the value on the button and in the title', () => {
    expect(decisionActionLabel('suggested', 27.5, 27)).toBe(`Appliquer 27${NBSP}%`)
    expect(decisionActionLabel('suggested', null, 30)).toBe(`Fixer à 30${NBSP}%`)
    expect(decisionActionLabel('maintained', 27.5, 27)).toBe(`Maintenir 27,5${NBSP}%`)
    expect(decisionActionLabel('custom', 27.5, 27)).toBe('Autre taux…')
    expect(decisionActionLabel('initial', null, 30)).toBe('Autre taux…')
    expect(decisionTitle('suggested', 27.5, 27)).toBe(`Appliquer 27${NBSP}%`)
    expect(decisionTitle('custom', 27.5, 27)).toBe('Taux particulier')
  })

  it('shows the pay before and after from the database’s amounts', () => {
    const pay = [
      { duration: 50 as const, clientPriceCents: 17500, appliedCents: 12688, suggestedCents: 12775, upcomingCents: null },
      { duration: 30 as const, clientPriceCents: 13000, appliedCents: null, suggestedCents: 9100, upcomingCents: null },
    ]
    expect(payChanges('suggested', pay)).toEqual([
      { duration: 50, beforeCents: 12688, afterCents: 12775 },
      { duration: 30, beforeCents: null, afterCents: 9100 },
    ])
    expect(payChanges('maintained', pay)).toEqual([{ duration: 50, beforeCents: 12688, afterCents: 12688 }])
    expect(payChanges('custom', pay)).toEqual([])
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

  it('lists the rows of one series, newest start first', () => {
    const rows = [
      { ...row('a', '2025-01-01', '2026-01-01'), kind: 'consultation' },
      { ...row('b', '2026-01-01', null), kind: 'consultation' },
      { ...row('c', '2026-03-01', null), kind: 'workshop' },
    ]
    expect(rowsOf(rows, (r) => r.kind === 'consultation').map((r) => r.id)).toEqual(['b', 'a'])
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

    it('never allows a row with a later one in its series', () => {
      const open = row('open', '2026-11-01', null)
      expect(canDeleteDated(previous, [previous, open], TODAY, NOW, { keepFirst: false })).toBe(false)
    })

    it('allows an ended last row (an agreement) within the window', () => {
      const ended = row('ended', '2026-10-01', '2026-12-01', '2026-10-08T10:00:00Z')
      expect(canDeleteDated(ended, [ended], TODAY, NOW, { keepFirst: false })).toBe(true)
    })

    it('keeps the first row of a clinic list, lets a professional’s first one go', () => {
      const only = row('only', '2026-11-01', null)
      expect(canDeleteDated(only, [only], TODAY, NOW, { keepFirst: true })).toBe(false)
      expect(canDeleteDated(only, [only], TODAY, NOW, { keepFirst: false })).toBe(true)
    })
  })
})
