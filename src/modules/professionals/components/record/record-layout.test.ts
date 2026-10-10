import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCompactOnScroll } from './record-layout'

describe('useCompactOnScroll', () => {
  let frames: FrameRequestCallback[] = []
  const scrollTo = (y: number) => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('scroll'))
      const pending = frames
      frames = []
      pending.forEach((frame) => frame(0))
    })
  }
  const room = (height: number) => Object.defineProperty(document.documentElement, 'scrollHeight', { value: height + window.innerHeight, configurable: true })

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    room(2000)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('compacts past 96 px and comes back only near the top, so its own change in height never flips it', () => {
    const { result } = renderHook(() => useCompactOnScroll(true))
    expect(result.current).toBe(false)
    scrollTo(60)
    expect(result.current).toBe(false)
    scrollTo(120)
    expect(result.current).toBe(true)
    // The header got shorter; the browser's scroll anchoring took that off scrollY.
    scrollTo(65)
    expect(result.current).toBe(true)
    scrollTo(4)
    expect(result.current).toBe(false)
  })

  it('never compacts a page with little to scroll, nor when not sticky', () => {
    room(150)
    const short = renderHook(() => useCompactOnScroll(true))
    scrollTo(140)
    expect(short.result.current).toBe(false)
    short.unmount()
    room(2000)
    const off = renderHook(() => useCompactOnScroll(false))
    scrollTo(500)
    expect(off.result.current).toBe(false)
  })
})
