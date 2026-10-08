import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNow } from './use-now'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('useNow', () => {
  it('starts at the current time and follows the clock every interval', () => {
    const { result } = renderHook(() => useNow(60_000))
    expect(result.current).toBe(Date.parse('2026-10-07T12:00:00Z'))
    act(() => vi.advanceTimersByTime(59_999))
    expect(result.current).toBe(Date.parse('2026-10-07T12:00:00Z'))
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(Date.parse('2026-10-07T12:01:00Z'))
  })

  it('stops ticking once unmounted', () => {
    const { unmount } = renderHook(() => useNow(60_000))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
