import * as React from 'react'

/**
 * The strip keeps the active tab in view (a record opened on its last tab, on a phone) and fades
 * its edge while more tabs are hidden on that side, so a cut strip says it scrolls.
 */
export function useStripInView(list: React.RefObject<HTMLDivElement | null>) {
  const [hidden, setHidden] = React.useState({ before: false, after: false })
  const update = React.useCallback(() => {
    const element = list.current
    if (!element) return
    const before = element.scrollLeft > 1
    const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    setHidden((h) => (h.before === before && h.after === after ? h : { before, after }))
  }, [list])
  React.useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const active = element.querySelector<HTMLElement>('[data-state="active"],[aria-selected="true"]')
    if (active) {
      const strip = element.getBoundingClientRect()
      const tab = active.getBoundingClientRect()
      if (tab.left < strip.left) element.scrollLeft -= strip.left - tab.left + 16
      else if (tab.right > strip.right) element.scrollLeft += tab.right - strip.right + 16
    }
    update()
  })
  React.useEffect(() => {
    const element = list.current
    if (!element) return
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [list, update])
  return hidden
}

/** The strip's fade on the side(s) where tabs are hidden. */
export function stripMaskClasses(hidden: { before: boolean; after: boolean }): string | false {
  if (hidden.after && !hidden.before) return '[mask-image:linear-gradient(to_right,black_85%,transparent)]'
  if (hidden.before && !hidden.after) return '[mask-image:linear-gradient(to_left,black_85%,transparent)]'
  if (hidden.before && hidden.after) return '[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]'
  return false
}
