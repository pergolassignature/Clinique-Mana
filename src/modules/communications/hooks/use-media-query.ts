import { useCallback, useSyncExternalStore } from 'react'

/** « Courriels » shows its three panes side by side from `lg`; below, the list, then the thread. */
export const WIDE_INBOX_QUERY = '(min-width: 1024px)'

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
