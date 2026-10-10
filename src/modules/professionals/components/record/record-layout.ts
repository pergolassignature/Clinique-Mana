import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react'

/** The record's two layouts (audit 2026-10-09 §2.7): the summary rail beside the tab from `xl`, as tiles above it from `md`. */
export const RAIL_QUERY = '(min-width: 1280px)'
export const STICKY_QUERY = '(min-width: 768px)'

/** Whether `query` matches, live; false where the window has no `matchMedia` (jsdom). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * Scroll thresholds of the compact header, far enough apart that the header's own change in height
 * (about 55 px, which the browser's scroll anchoring may take off `scrollY`) never flips it back:
 * compact past 96 px, full again under 8 px; never on a page with less than 200 px to scroll, where
 * the shorter header could leave nothing to scroll.
 */
const COMPACT_FROM = 96
const FULL_UNDER = 8
const MIN_ROOM = 200

/** Whether the sticky record header should drop its meta line: the window has scrolled past the top (`enabled` only). */
export function useCompactOnScroll(enabled: boolean): boolean {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setCompact(false)
      return
    }
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      const room = document.documentElement.scrollHeight - window.innerHeight
      setCompact((was) => (was ? y >= FULL_UNDER : y > COMPACT_FROM && room > MIN_ROOM))
    }
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [enabled])
  return compact
}

/**
 * Whether the element, plus `reserved` px (what sticks above it and the gaps), fits in the window's
 * height, live (the element's and the window's resizes); false when not `enabled`. A rail that does
 * not fit scrolls with the page instead of sticking with its end out of reach.
 */
export function useFitsInWindow(ref: RefObject<HTMLElement | null>, reserved: number, enabled: boolean): boolean {
  const [height, setHeight] = useState<number | null>(null)
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const element = ref.current
    if (!enabled || !element || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => setHeight(element.getBoundingClientRect().height))
    observer.observe(element)
    const onResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [ref, enabled])
  return enabled && height !== null && height + reserved <= windowHeight
}

/**
 * The sticky header's height (0 when not `enabled` or without `ResizeObserver`), and, while it
 * sticks, the window's `scroll-padding-top` under it and the top bar: a control reached with Tab
 * behind the header scrolls into view below it, not under it (WCAG 2.4.11). Restored on unmount.
 */
export function useStickyHeight(ref: RefObject<HTMLElement | null>, enabled: boolean): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!enabled || !element || typeof ResizeObserver !== 'function') {
      setHeight(0)
      return
    }
    const observer = new ResizeObserver(() => setHeight(Math.round(element.getBoundingClientRect().height)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, enabled])
  useEffect(() => {
    if (height === 0) return
    const root = document.documentElement
    const previous = root.style.scrollPaddingTop
    // The top bar (48) and the header that sticks under it, plus a little room.
    root.style.scrollPaddingTop = `calc(var(--topbar-h) + ${height + 8}px)`
    return () => {
      root.style.scrollPaddingTop = previous
    }
  }, [height])
  return height
}
