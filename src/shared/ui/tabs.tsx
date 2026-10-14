import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'

/**
 * Page-level views (« Utilisateurs / Rôles »), drawn like NavTabs (13px, ink underline when
 * active, 1px baseline). Real tabs (decision #35): one tab stop, the arrow keys switch views,
 * Tab then goes into the panel. Section tabs inside a form or sheet use NavTabs instead
 * (CLAUDE.md §10). The tabs' focus ring is inset (2px teal): the strip scrolls sideways, so an
 * outer ring would be clipped. The strip's scrollbar is hidden (`scrollbar-hide`): it still scrolls
 * by touch, trackpad and wheel, and the browser scrolls the focused tab into view.
 */
const Tabs = TabsPrimitive.Root

/**
 * The strip keeps the active tab in view (a record opened on its last tab, on a phone) and fades
 * its edge while more tabs are hidden on that side, so a cut strip says it scrolls.
 */
function useStripInView(list: React.RefObject<HTMLDivElement | null>) {
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
    const active = element.querySelector<HTMLElement>('[data-state="active"]')
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

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => {
    const inner = React.useRef<HTMLDivElement>(null)
    React.useImperativeHandle(ref, () => inner.current as HTMLDivElement)
    const hidden = useStripInView(inner)
    return (
      <TabsPrimitive.List
        ref={inner}
        className={cn(
          'scrollbar-hide flex overflow-x-auto overflow-y-hidden border-b border-border',
          hidden.after && !hidden.before && '[mask-image:linear-gradient(to_right,black_85%,transparent)]',
          hidden.before && !hidden.after && '[mask-image:linear-gradient(to_left,black_85%,transparent)]',
          hidden.before && hidden.after && '[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]',
          className,
        )}
        {...props}
      />
    )
  }
)
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        `-mb-px mr-3 flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-0.5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-ink data-[state=active]:font-medium data-[state=active]:text-foreground focus-visible:shadow-[inset_0_0_0_2px_rgb(var(--focus-ring))] focus-visible:outline-none [&_svg]:size-3.5 [&_svg]:shrink-0`,
        className
      )}
      {...props}
    />
  )
)
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

/** The panel; focusable by Radix (Tab from the tab list lands on it when it has no control first). */
const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn(`rounded-sm ${focusRing}`, className)} {...props} />
)
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
