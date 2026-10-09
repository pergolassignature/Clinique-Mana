import { useEffect, useState, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/** Marks a placeholder that is no content (a card's Suspense fallback while its chunk loads). */
export const PENDING_ATTRIBUTE = 'data-pending'

/** How long the page must stay quiet (nothing loading, nothing shown) before it reads as empty. */
const SETTLE_MS = 150

/**
 * Whether the container shows nothing once everything in it has loaded: Accueil's module cards
 * and notices render nothing when they have nothing to say, and only they know (a module's card
 * is its own code), so their DOM is read. A direct child that is not a pending placeholder is
 * content; while a placeholder remains or any query is fetching, the answer is kept as it was
 * (false at first), so the empty state never flashes before a card that is still loading. Content
 * appearing hides it at once; it shows again when the content goes (a notice marked read).
 * The bell's count polls in the background: a fetch only defers the answer, never flips it.
 */
export function useNothingShown(ref: RefObject<HTMLElement | null>): boolean {
  const queryClient = useQueryClient()
  const [empty, setEmpty] = useState(false)

  useEffect(() => {
    const container = ref.current
    if (!container) return
    const hasContent = () => Array.from(container.children).some((child) => !child.hasAttribute(PENDING_ATTRIBUTE))
    let timer: number | undefined
    const evaluate = () => {
      if (hasContent()) setEmpty(false)
      else if (container.children.length === 0 && queryClient.isFetching() === 0) setEmpty(true)
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(evaluate, SETTLE_MS)
    }
    const observer = new MutationObserver(() => {
      if (hasContent()) setEmpty(false)
      schedule()
    })
    observer.observe(container, { childList: true })
    const unsubscribe = queryClient.getQueryCache().subscribe(schedule)
    schedule()
    return () => {
      observer.disconnect()
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [ref, queryClient])

  return empty
}
