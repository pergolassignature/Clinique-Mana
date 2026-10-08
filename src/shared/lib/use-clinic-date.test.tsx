import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useClinicDate } from './use-clinic-date'

afterEach(() => vi.useRealTimers())

describe('useClinicDate (America/Toronto)', () => {
  it('is the clinic date, not the UTC date', () => {
    vi.useFakeTimers()
    // 22:30 on 7 October in the clinic, already 8 October in UTC.
    vi.setSystemTime(new Date('2026-10-08T02:30:00Z'))
    const { result } = renderHook(() => useClinicDate())
    expect(result.current).toBe('2026-10-07')
  })

  it('changes at the clinic’s midnight, with one timer and no re-render before', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T02:30:00Z'))
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useClinicDate()
    })
    const before = renders
    expect(vi.getTimerCount()).toBe(1)
    // 23:59:59 in the clinic: still the 7th, nothing re-rendered.
    act(() => vi.advanceTimersByTime(89 * 60_000 + 59_000))
    expect(result.current).toBe('2026-10-07')
    expect(renders).toBe(before)
    // Midnight (04:00 UTC) plus the margin.
    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current).toBe('2026-10-08')
    expect(vi.getTimerCount()).toBe(1)
  })

  it('reads the clock again when the timer fires before the date changed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T02:30:00Z'))
    const { result } = renderHook(() => useClinicDate())
    // The clock is set back (e.g. corrected) so the timer fires on the same clinic date.
    act(() => {
      vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
      vi.advanceTimersToNextTimer()
    })
    expect(result.current).toBe('2026-10-07')
    expect(vi.getTimerCount()).toBe(1)
  })
})
