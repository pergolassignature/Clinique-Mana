import { beforeAll, describe, expect, it } from 'vitest'
import { setClinicTimezone } from '@/shared/lib/timezone'
import type { AvailabilityRule } from '../api/parse'
import { packLanes, verticalBox, windowsOn } from './layout'
import { addDays, instantOf, isoWeekday, minutesOnDay, monthGrid, snap, startOfWeek } from './time'

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
    expect(verticalBox(540, 720, 48)).toEqual({ top: 96, height: 144 })
  })
})
