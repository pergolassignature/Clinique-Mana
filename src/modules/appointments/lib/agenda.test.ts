import { beforeAll, describe, expect, it } from 'vitest'
import { setClinicTimezone } from '@/shared/lib/timezone'
import type { AvailabilityRule } from '../api/parse'
import { busyOn, packLanes, verticalBox, windowsOn } from './layout'
import { addDays, gridRangeFor, instantOf, isoWeekday, minutesOnDay, monthGrid, snap, startOfWeek } from './time'

beforeAll(() => setClinicTimezone('America/Toronto'))

describe('the agenda calendar', () => {
  it('counts calendar days, never 24-hour steps, across the daylight-saving changes', () => {
    expect(addDays('2027-03-13', 1)).toBe('2027-03-14')
    expect(addDays('2027-03-14', 1)).toBe('2027-03-15')
    expect(addDays('2027-11-06', 2)).toBe('2027-11-08')
    expect(isoWeekday('2027-03-14')).toBe(7)
    expect(startOfWeek('2027-03-14')).toBe('2027-03-08')
    expect(monthGrid('2027-03-14')[0]).toBe('2027-03-01')
  })

  it('places 9:00 on the 9:00 line on both 2027 change Sundays', () => {
    expect(instantOf('2027-03-14', 9 * 60)).toBe('2027-03-14T13:00:00.000Z')
    expect(instantOf('2027-11-07', 9 * 60)).toBe('2027-11-07T14:00:00.000Z')
    expect(minutesOnDay('2027-03-14T13:00:00Z', '2027-03-14')).toBe(540)
    expect(minutesOnDay('2027-11-07T14:00:00Z', '2027-11-07')).toBe(540)
    expect(minutesOnDay('2027-11-08T14:00:00Z', '2027-11-07')).toBe(1440)
  })

  it('snaps a drag to 15 minutes', () => {
    expect(snap(547)).toBe(540)
    expect(snap(553)).toBe(555)
    expect(snap(-7)).toBe(-0)
  })

  it('packs overlapping appointments in lanes', () => {
    const placed = packLanes([
      { item: 'a', start: 540, end: 600 },
      { item: 'b', start: 570, end: 630 },
      { item: 'c', start: 660, end: 720 },
    ])
    expect(placed.map((p) => [p.item, p.lane, p.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ])
  })

  it("finds a professional's windows on a date (weekday and validity) and boxes them", () => {
    const rule: AvailabilityRule = {
      id: 'r',
      professionalId: 'p',
      weekday: 1,
      startTime: '09:00',
      endTime: '12:00',
      serviceIds: [],
      visibleToClients: true,
      overflowAllowed: false,
      validFrom: '2027-01-01',
      validUntil: '2027-06-30',
    }
    expect(windowsOn([rule], 'p', '2027-03-15')).toEqual([{ rule, start: 540, end: 720 }])
    expect(windowsOn([rule], 'p', '2027-07-05')).toEqual([])
    expect(windowsOn([rule], 'p', '2027-03-16')).toEqual([])
    expect(verticalBox(540, 720, 48)).toEqual({ top: 144, height: 144 })
    // A grid widened to 5:00 (an appointment before 6:00, never hidden).
    expect(verticalBox(300, 330, 48, { start: 300, end: 22 * 60 })).toEqual({ top: 0, height: 24 })
  })
})

describe('the grid range (AP-33)', () => {
  it('6:00–22:00 by default, widened by whole hours to any appointment outside it, within the day', () => {
    expect(gridRangeFor([])).toEqual({ start: 360, end: 1320 })
    expect(gridRangeFor([{ start: 600, end: 650 }])).toEqual({ start: 360, end: 1320 })
    expect(gridRangeFor([{ start: 5 * 60 + 30, end: 6 * 60 + 20 }, { start: 22 * 60 + 15, end: 23 * 60 + 5 }])).toEqual({ start: 300, end: 24 * 60 })
    expect(gridRangeFor([{ start: 0, end: 30 }])).toEqual({ start: 0, end: 1320 })
    expect(gridRangeFor([{ start: 700, end: 700 }])).toEqual({ start: 360, end: 1320 })
  })
})

describe('Google busy times (R6)', () => {
  it('a professional’s busy times on a day, clipped to it, others’ left out', () => {
    const busy = [
      { professionalId: 'p', startsAt: '2027-03-15T13:00:00Z', endsAt: '2027-03-15T14:30:00Z' },
      // Across midnight: clipped to each day.
      { professionalId: 'p', startsAt: '2027-03-16T03:00:00Z', endsAt: '2027-03-16T06:00:00Z' },
      { professionalId: 'q', startsAt: '2027-03-15T13:00:00Z', endsAt: '2027-03-15T14:00:00Z' },
    ]
    expect(busyOn(busy, 'p', '2027-03-15')).toEqual([
      { start: 9 * 60, end: 10 * 60 + 30 },
      { start: 23 * 60, end: 24 * 60 },
    ])
    expect(busyOn(busy, 'p', '2027-03-16')).toEqual([{ start: 0, end: 2 * 60 }])
    expect(busyOn(busy, 'q', '2027-03-17')).toEqual([])
  })
})
