import { describe, expect, it } from 'vitest'
import {
  addedParts,
  clockLabel,
  minutesAtOffset,
  moveRange,
  overlapsAny,
  previewMerge,
  rangeFromClick,
  rangeFromDrag,
  resizeRange,
  sameSettings,
  snappedDelta,
  windowPhrase,
} from './availability-edit'

const H = (h: number, m = 0) => h * 60 + m

describe('snapping', () => {
  it('reads the pointer as minutes below 6:00 and snaps distances to quarter hours', () => {
    expect(minutesAtOffset(48 * 3, 48)).toBe(H(9))
    expect(snappedDelta(48 / 4 + 5, 48)).toBe(15)
    expect(snappedDelta(48 / 8 - 1, 48)).toBe(0)
    expect(snappedDelta(-48, 48)).toBe(-60)
  })

  it('a drag down covers from its quarter hour to the line nearest the pointer', () => {
    expect(rangeFromDrag(H(9, 7), H(11, 55))).toEqual({ start: H(9), end: H(12) })
    expect(rangeFromDrag(H(9, 7), H(12, 4))).toEqual({ start: H(9), end: H(12) })
  })

  it('a drag up works the other way', () => {
    expect(rangeFromDrag(H(12, 5), H(9, 5))).toEqual({ start: H(9), end: H(12, 15) })
  })

  it('a tiny drag is one quarter hour; never off the grid', () => {
    expect(rangeFromDrag(H(9, 2), H(9, 9))).toEqual({ start: H(9), end: H(9, 15) })
    expect(rangeFromDrag(H(21, 50), H(23))).toEqual({ start: H(21, 45), end: H(22) })
    expect(rangeFromDrag(H(8), H(5))).toEqual({ start: H(6), end: H(8, 15) })
  })

  it('a click is one hour from its quarter hour', () => {
    expect(rangeFromClick(H(13, 20))).toEqual({ start: H(13, 15), end: H(14, 15) })
    expect(rangeFromClick(H(21, 40))).toEqual({ start: H(21, 30), end: H(22) })
  })

  it('a move keeps the length and stays on the grid', () => {
    expect(moveRange({ start: H(9), end: H(12) }, 90)).toEqual({ start: H(10, 30), end: H(13, 30) })
    expect(moveRange({ start: H(9), end: H(12) }, -240)).toEqual({ start: H(6), end: H(9) })
    expect(moveRange({ start: H(19), end: H(21) }, 120)).toEqual({ start: H(20), end: H(22) })
  })

  it('a resize moves one edge, a quarter hour long at least', () => {
    expect(resizeRange({ start: H(9), end: H(12) }, 'end', -60)).toEqual({ start: H(9), end: H(11) })
    expect(resizeRange({ start: H(9), end: H(12) }, 'start', 60)).toEqual({ start: H(10), end: H(12) })
    expect(resizeRange({ start: H(9), end: H(12) }, 'start', 600)).toEqual({ start: H(11, 45), end: H(12) })
    expect(resizeRange({ start: H(9), end: H(12) }, 'end', 900)).toEqual({ start: H(9), end: H(22) })
  })
})

describe('previewMerge', () => {
  const w = (id: string, start: number, end: number, compatible = true) => ({ id, start, end, compatible })

  it('merges a touching or overlapping window of the same settings', () => {
    expect(previewMerge([w('a', H(9), H(12))], { start: H(12), end: H(14) })).toEqual({ start: H(9), end: H(14), absorbed: ['a'], conflict: false })
    expect(previewMerge([w('a', H(9), H(12))], { start: H(11), end: H(13) })).toMatchObject({ start: H(9), end: H(13), absorbed: ['a'] })
  })

  it('merges a chain', () => {
    const others = [w('a', H(9), H(10)), w('b', H(11), H(12)), w('c', H(12), H(13))]
    expect(previewMerge(others, { start: H(9, 30), end: H(11) })).toEqual({ start: H(9), end: H(13), absorbed: ['a', 'b', 'c'], conflict: false })
  })

  it('leaves a window apart', () => {
    expect(previewMerge([w('a', H(14), H(16))], { start: H(9), end: H(12) })).toEqual({ start: H(9), end: H(12), absorbed: [], conflict: false })
  })

  it('other settings: overlapping is a conflict, touching is not', () => {
    expect(previewMerge([w('a', H(9), H(12), false)], { start: H(11), end: H(13) }).conflict).toBe(true)
    expect(previewMerge([w('a', H(9), H(12), false)], { start: H(12), end: H(13) })).toEqual({ start: H(12), end: H(13), absorbed: [], conflict: false })
  })

  it('a merge that reaches a window with other settings is a conflict', () => {
    expect(previewMerge([w('a', H(9), H(12)), w('b', H(8), H(10), false)], { start: H(11), end: H(13) }).conflict).toBe(true)
  })
})

describe('settings and labels', () => {
  const base = { serviceIds: ['s2', 's1'], visibleToClients: true, overflowAllowed: false, validUntil: null }

  it('compares the settings that merge', () => {
    expect(sameSettings(base, { ...base, serviceIds: ['s1', 's2'] })).toBe(true)
    expect(sameSettings(base, { ...base, overflowAllowed: true })).toBe(false)
    expect(sameSettings(base, { ...base, validUntil: '2027-03-21' })).toBe(false)
  })

  it('overlaps an exception', () => {
    expect(overlapsAny([{ start: H(10), end: H(11) }], { start: H(9), end: H(10, 15) })).toBe(true)
    expect(overlapsAny([{ start: H(10), end: H(11) }], { start: H(11), end: H(12) })).toBe(false)
  })

  it('the time a change adds: all of a new window, else what lies outside where it was', () => {
    expect(addedParts(null, { start: H(9), end: H(12) })).toEqual([{ start: H(9), end: H(12) }])
    expect(addedParts({ start: H(9), end: H(17) }, { start: H(11), end: H(17) })).toEqual([])
    expect(addedParts({ start: H(9), end: H(12) }, { start: H(8), end: H(13) })).toEqual([
      { start: H(8), end: H(9) },
      { start: H(12), end: H(13) },
    ])
    expect(addedParts({ start: H(9), end: H(12) }, { start: H(10), end: H(13) })).toEqual([{ start: H(12), end: H(13) }])
  })

  it('says the times as in Québec', () => {
    expect(clockLabel(H(9))).toBe('9 h')
    expect(clockLabel(H(9, 30))).toBe('9 h 30')
    expect(clockLabel(H(13, 5))).toBe('13 h 05')
    expect(windowPhrase(2, { start: H(9), end: H(12) })).toBe('mardi 9 h – 12 h')
  })
})
