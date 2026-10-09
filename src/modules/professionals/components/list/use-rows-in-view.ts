import { useCallback, useEffect, useRef, useState } from 'react'

/** How long row arrivals are gathered before the set grows: one scroll adds one batch. */
const SETTLE_MS = 100
/** Rows this close below the viewport count as in view (their photo is ready when they arrive). */
const ROOT_MARGIN = '0px 0px 200px 0px'

/**
 * The rows that have been in view (or about to be), by id: the list signs only their photos.
 * `observe(id)` is a ref callback for a row's element; once a row has been seen it stays seen
 * (its photo is already signed and cached). Arrivals within 100 ms are added together, so a
 * scroll makes one `storage-sign` call, not one per row. Without IntersectionObserver (old
 * browsers, tests) every observed row counts as seen.
 */
export function useRowsInView(): { seen: ReadonlySet<string>; observe: (id: string) => (element: HTMLElement | null) => (() => void) | undefined } {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  const observer = useRef<IntersectionObserver | null>(null)
  const pending = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const ids = useRef(new WeakMap<Element, string>())

  const flush = useCallback(() => {
    timer.current = undefined
    const arrived = [...pending.current]
    pending.current.clear()
    if (arrived.length > 0) setSeen((current) => (arrived.every((id) => current.has(id)) ? current : new Set([...current, ...arrived])))
  }, [])

  const arrive = useCallback(
    (id: string) => {
      pending.current.add(id)
      if (timer.current === undefined) timer.current = setTimeout(flush, SETTLE_MS)
    },
    [flush],
  )

  const getObserver = useCallback(() => {
    if (observer.current === null && typeof IntersectionObserver !== 'undefined') {
      observer.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = ids.current.get(entry.target)
            if (!entry.isIntersecting || id === undefined) continue
            arrive(id)
            observer.current?.unobserve(entry.target)
          }
        },
        { rootMargin: ROOT_MARGIN },
      )
    }
    return observer.current
  }, [arrive])

  useEffect(
    () => () => {
      observer.current?.disconnect()
      observer.current = null
      clearTimeout(timer.current)
      timer.current = undefined
    },
    [],
  )

  const observe = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element === null) return undefined
      const current = getObserver()
      if (current === null) {
        arrive(id)
        return undefined
      }
      ids.current.set(element, id)
      current.observe(element)
      return () => current.unobserve(element)
    },
    [arrive, getObserver],
  )

  return { seen, observe }
}
