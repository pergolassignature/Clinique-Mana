import { beforeAll, describe, expect, it } from 'vitest'
import { CALENDAR_GRID_STRING_KEYS } from '@pergolas-signature/calendar-ui'
import { t, type TranslationKey } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import type { ExternalBusy } from '../api/calendar'
import type { AvailabilityException, AvailabilityRule } from '../api/parse'
import { gridDay, gridDays, gridText, gridWordPath, toGridColumns, toGridLayers } from './calendar-grid'

beforeAll(() => setClinicTimezone('America/Toronto'))

const rule = (overrides: Partial<AvailabilityRule>): AvailabilityRule =>
  ({ id: 'r1', professionalId: 'p1', weekday: 1, startTime: '09:00', endTime: '12:00', validFrom: '2027-01-01', validUntil: null, ...overrides }) as AvailabilityRule
const exception = (overrides: Partial<AvailabilityException>): AvailabilityException => ({
  id: 'x1',
  professionalId: 'p1',
  kind: 'vacation',
  startsAt: '2027-03-15T17:00:00Z',
  endsAt: '2027-03-16T13:00:00Z',
  label: null,
  ...overrides,
}) as AvailabilityException

describe('the grid’s words', () => {
  it('fr-CA has every key the grid asks for', () => {
    const missing = CALENDAR_GRID_STRING_KEYS.filter((key) => t(gridWordPath(key) as TranslationKey) === gridWordPath(key))
    expect(missing).toEqual([])
  })

  it('fills the grid’s values as text', () => {
    expect(gridText('calendar.grid.announceDrop', { name: 'Alice Essai' })).toBe('Alice Essai déposé.')
    expect(gridText('calendar.grid.weekStrip')).toBe('Jours de la semaine')
  })
})

describe('the grid’s days and columns', () => {
  it('gives a clinic date its midnight in the clinic’s zone, on the change Sunday too', () => {
    expect(gridDay('2027-03-15').toISOString()).toBe('2027-03-15T04:00:00.000Z')
    expect(gridDay('2027-03-14').toISOString()).toBe('2027-03-14T05:00:00.000Z')
  })

  it('makes a professional the column’s resource, and lists each day once', () => {
    const columns = [
      { key: 'p1', day: '2027-03-15', professionalId: 'p1', label: 'Annie' },
      { key: 'p2', day: '2027-03-15', professionalId: 'p2', label: 'Benoît', sublabel: 'Psychologue' },
    ]
    expect(toGridColumns(columns).map((c) => [c.key, c.resourceKey, c.label, c.sublabel])).toEqual([
      ['p1', 'p1', 'Annie', undefined],
      ['p2', 'p2', 'Benoît', 'Psychologue'],
    ])
    expect(gridDays(columns).map((d) => d.toISOString())).toEqual(['2027-03-15T04:00:00.000Z'])
  })
})

describe('the grid’s layers', () => {
  const busy: ExternalBusy[] = [{ professionalId: 'p2', startsAt: '2027-03-15T17:00:00Z', endsAt: '2027-03-15T18:00:00Z' } as ExternalBusy]

  it('lays each professional’s window, exception and busy time in her own column', () => {
    const columns = [
      { key: 'p1', day: '2027-03-15', professionalId: 'p1', label: 'Annie' },
      { key: 'p2', day: '2027-03-15', professionalId: 'p2', label: 'Benoît' },
    ]
    const layers = toGridLayers(columns, { rules: [rule({})], exceptions: [exception({})], busy, shadeProfessionalId: null })
    expect(layers.map((l) => [l.kind, l.resourceKey, l.start.toISOString(), l.end.toISOString(), l.label])).toEqual([
      // Monday 9:00–12:00, EDT.
      ['shade', 'p1', '2027-03-15T13:00:00.000Z', '2027-03-15T16:00:00.000Z', undefined],
      // From 13:00 to the day's end: the next midnight.
      ['hatch', 'p1', '2027-03-15T17:00:00.000Z', '2027-03-16T04:00:00.000Z', undefined],
      ['busy', 'p2', '2027-03-15T17:00:00.000Z', '2027-03-15T18:00:00.000Z', 'Occupé'],
    ])
  })

  it('shades a week of several professionals for no one, and a week of one for her', () => {
    const week = ['2027-03-15', '2027-03-16'].map((day) => ({ key: day, day, professionalId: null, label: day }))
    expect(toGridLayers(week, { rules: [rule({})], exceptions: [], busy: [], shadeProfessionalId: null })).toEqual([])
    const hers = toGridLayers(week, { rules: [rule({})], exceptions: [], busy: [], shadeProfessionalId: 'p1' })
    // Monday's window only; the column has no resource of its own, so neither has its layer.
    expect(hers.map((l) => [l.kind, l.resourceKey ?? null, l.start.toISOString()])).toEqual([['shade', null, '2027-03-15T13:00:00.000Z']])
  })
})
