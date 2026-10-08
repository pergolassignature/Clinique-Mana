import { describe, expect, it } from 'vitest'
import type { ReviewRow } from '../api/compensation'
import { changedEntries, countByFilter, countByStatus, draftCount, filterRows, invalidRows, isChanged, isImportedBalance, liveTotal, onlyImportedBalances, shownCounts } from './review'

const row = (id: string, over: Partial<ReviewRow> = {}): ReviewRow => ({
  id,
  firstName: 'Paul',
  lastName: id,
  titleName: 'Psychologue',
  entry: { long: 20, short: 4, adjustment: 0, note: null, updatedAt: `v-${id}` },
  sessionsBefore: 33.5,
  floorPct: 25,
  increaseDecided: false,
  agreements: 0,
  sessionsTotal: 55.5,
  applied: null,
  previousPct: null,
  inForcePct: null,
  suggested: null,
  next: null,
  status: 'gap',
  pay: [],
  ...over,
})

describe('the review’s drafts (P4-190)', () => {
  const stored = row('a')
  const empty = row('b', { entry: null, sessionsBefore: 10, sessionsTotal: 10, status: 'conforme' })

  it('shows the draft, else the stored counts, else blanks', () => {
    expect(shownCounts(stored, {})).toEqual({ long: '20', short: '4' })
    expect(shownCounts(empty, {})).toEqual({ long: '', short: '' })
    expect(shownCounts(stored, { a: { long: '21', short: '4', version: 'v-a' } })).toEqual({ long: '21', short: '4' })
  })

  it('reads blanks as 0 and refuses anything but whole counts up to 2 000', () => {
    expect(draftCount('')).toBe(0)
    expect(draftCount('12')).toBe(12)
    expect(draftCount('1,5')).toBeNull()
    expect(draftCount('2001')).toBeNull()
  })

  it('sends only the rows that changed, with the version each draft started from', () => {
    const drafts = {
      a: { long: '20', short: '4', version: 'v-a' }, // typed back to what is stored
      b: { long: '6', short: '', version: null },
    }
    expect(isChanged(stored, drafts.a)).toBe(false)
    expect(changedEntries([stored, empty], drafts)).toEqual([{ professionalId: 'b', long: 6, short: 0, expectedUpdatedAt: null }])
  })

  it('flags an invalid draft and gives it no live total', () => {
    const drafts = { a: { long: 'x', short: '4', version: 'v-a' } }
    expect(invalidRows([stored], drafts)).toEqual(new Set(['a']))
    expect(liveTotal(stored, drafts)).toBeNull()
  })

  it('computes the live total from the count before the month and the month’s adjustment', () => {
    const adjusted = row('c', { entry: { long: 0, short: 0, adjustment: 33.5, note: 'Solde importé', updatedAt: 'v-c' }, sessionsBefore: 0, sessionsTotal: 33.5 })
    expect(liveTotal(adjusted, { c: { long: '10', short: '3', version: 'v-c' } })).toBe(45)
    expect(liveTotal(stored, {})).toBe(55.5)
  })

  it('filters « À décider » (gaps and starting rates) and keeps a row being edited visible', () => {
    const noRate = row('c', { status: 'no_rate' })
    const kept = row('d', { status: 'maintained' })
    expect(filterRows([stored, empty, noRate, kept], 'todo', {}).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterRows([stored, empty], 'todo', { b: { long: '1', short: '', version: null } }).map((r) => r.id)).toEqual(['a', 'b'])
    expect(filterRows([stored, empty, noRate, kept], 'kept', {}).map((r) => r.id)).toEqual(['d'])
    expect(filterRows([stored, empty], 'all', {})).toHaveLength(2)
    expect(countByFilter([stored, empty, noRate, kept])).toEqual({ todo: 2, all: 4, conforme: 1, floor: 0, kept: 1, profession_unconfirmed: 0 })
    expect(countByStatus([stored, empty, noRate])).toMatchObject({ gap: 1, no_rate: 1, conforme: 1, floor: 0 })
  })
})

describe('imported opening balances (P4-192)', () => {
  const imported = row('i', { entry: { long: 0, short: 0, adjustment: 62.5, note: 'Solde importé', updatedAt: 'v-i' } })
  const typed = row('t')
  const none = row('n', { entry: null })

  it('recognises a month that is only the import’s balance', () => {
    expect(isImportedBalance(imported)).toBe(true)
    expect(isImportedBalance(typed)).toBe(false)
    expect(isImportedBalance(row('o', { entry: { long: 0, short: 0, adjustment: 12, note: 'Solde d’ouverture', updatedAt: 'v' } }))).toBe(false)
    expect(isImportedBalance(row('m', { entry: { long: 3, short: 0, adjustment: 62.5, note: 'Solde importé', updatedAt: 'v' } }))).toBe(false)
  })

  it('skips a month holding nothing but imported balances, never an empty one or one with sessions', () => {
    expect(onlyImportedBalances([imported, none])).toBe(true)
    expect(onlyImportedBalances([imported, typed])).toBe(false)
    expect(onlyImportedBalances([none])).toBe(false)
    expect(onlyImportedBalances([])).toBe(false)
  })
})
