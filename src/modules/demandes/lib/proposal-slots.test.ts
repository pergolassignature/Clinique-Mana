import { beforeAll, describe, expect, it } from 'vitest'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { columnsOf, DEFAULT_INBOX_COLUMNS } from './inbox-columns'
import { defaultServiceId, slotPeriod, suitsPeriods } from './proposal-slots'

beforeAll(() => setClinicTimezone('America/Toronto'))

// Tuesday 20 October 2026 and Saturday 24 October 2026, Toronto (UTC−4).
const at = (day: string, hour: string) => `${day}T${hour}:00-04:00`

describe('the moments of a slot (D-49)', () => {
  it('matin, après-midi, fin de journée, soir; the weekend apart', () => {
    expect(slotPeriod(at('2026-10-20', '09:00'))).toEqual({ period: 'am', weekend: false })
    expect(slotPeriod(at('2026-10-20', '13:00'))).toEqual({ period: 'pm', weekend: false })
    expect(slotPeriod(at('2026-10-20', '16:30'))).toEqual({ period: 'end_of_day', weekend: false })
    expect(slotPeriod(at('2026-10-20', '19:00'))).toEqual({ period: 'evening', weekend: false })
    expect(slotPeriod(at('2026-10-24', '10:00')).weekend).toBe(true)
  })

  it('a slot suits the periods the person gave; none given: all suit', () => {
    expect(suitsPeriods(at('2026-10-20', '19:00'), ['evening'])).toBe(true)
    expect(suitsPeriods(at('2026-10-20', '09:00'), ['evening'])).toBe(false)
    expect(suitsPeriods(at('2026-10-24', '10:00'), ['weekend'])).toBe(true)
    expect(suitsPeriods(at('2026-10-24', '10:00'), ['am'])).toBe(false)
    expect(suitsPeriods(at('2026-10-20', '09:00'), [])).toBe(true)
  })
})

describe('the default service (D-48)', () => {
  const services = [
    { id: 'i30', duration_minutes: 30, for_two: false },
    { id: 'i50', duration_minutes: 50, for_two: false },
    { id: 'c60', duration_minutes: 60, for_two: true },
  ]
  it('the 50-minute session; a couple\'s service for a couple; none offered: none', () => {
    expect(defaultServiceId(services, false)).toBe('i50')
    expect(defaultServiceId(services, true)).toBe('c60')
    expect(defaultServiceId(services.slice(0, 2), true)).toBe('i50')
    expect(defaultServiceId([], false)).toBeNull()
  })
})

describe('the inbox columns (D-47)', () => {
  it('the stored ones in the table\'s order, unknown ones dropped; none stored: the defaults', () => {
    expect(columnsOf({ columns: ['motifs', 'state', 'nope'] })).toEqual(['state', 'motifs'])
    expect(columnsOf(null)).toEqual([...DEFAULT_INBOX_COLUMNS])
    expect(columnsOf({ columns: [] })).toEqual([])
  })
})
