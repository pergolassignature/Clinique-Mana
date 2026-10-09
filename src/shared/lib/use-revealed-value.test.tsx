import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { REVEAL_DURATION_MS, useRevealedValue } from './use-revealed-value'

// The timing, visibility and stale-answer rules are also covered through Phase 2's
// `useRevealedAccountNumber` (src/core/settings/bank/hooks.test.tsx), which wraps this hook.

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useRevealedValue', () => {
  it('keeps the value in state for 60 seconds, then drops it', async () => {
    vi.useFakeTimers()
    const fetchValue = vi.fn().mockResolvedValue('046454286')
    const { result } = renderHook(() => useRevealedValue({ fetchValue, onError: vi.fn() }))
    await act(() => result.current.reveal())
    expect(result.current.value).toBe('046454286')
    act(() => vi.advanceTimersByTime(REVEAL_DURATION_MS))
    expect(result.current.value).toBeNull()
  })

  it('calls the latest callbacks: onNothing for null, onError (without the value) for a failure', async () => {
    const onNothing = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const fetchValue = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce({ code: 'P0001', message: 'Refus.' })
    const { result, rerender } = renderHook(({ onError }) => useRevealedValue({ fetchValue, onNothing, onError }), { initialProps: { onError: first } })
    await act(() => result.current.reveal())
    expect(onNothing).toHaveBeenCalledOnce()
    rerender({ onError: second })
    await act(() => result.current.reveal())
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ code: 'P0001', message: 'Refus.' })
    expect(result.current.value).toBeNull()
    expect(result.current.pending).toBe(false)
  })

  it('drops the value when the browser tab is hidden', async () => {
    const fetchValue = vi.fn().mockResolvedValue('1234567')
    const { result } = renderHook(() => useRevealedValue({ fetchValue, onError: vi.fn() }))
    await act(() => result.current.reveal())
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.value).toBeNull()
  })
})
