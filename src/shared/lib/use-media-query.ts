import { useSyncExternalStore } from 'react'

/**
 * Whether a media query matches now, following its changes (a window resized, a phone turned).
 * False where `matchMedia` does not exist (tests, old browsers): the desktop layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/** A phone: below Tailwind's `sm` (640 px). */
export const PHONE_QUERY = '(max-width: 639px)'
