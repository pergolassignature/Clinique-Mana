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

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.List ref={ref} className={cn('scrollbar-hide flex overflow-x-auto overflow-y-hidden border-b border-border', className)} {...props} />
  )
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
