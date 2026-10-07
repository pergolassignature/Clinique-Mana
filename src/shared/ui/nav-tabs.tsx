import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'

/**
 * NavTabs - Navigation tabs that are excluded from keyboard tab order.
 *
 * Use this component for section navigation within forms/dialogs.
 * These tabs are clickable but won't interrupt the Tab key flow through form fields.
 * Users can still use arrow keys to navigate between tabs when focused.
 *
 * For accessibility, users can:
 * - Click tabs with mouse
 * - Use Escape to close the dialog, then reopen and click a different tab
 * - Use arrow keys when a tab is focused (if implemented with proper ARIA)
 */

interface NavTabsProps {
  className?: string
  children: React.ReactNode
}

const NavTabs = React.forwardRef<HTMLDivElement, NavTabsProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      role="tablist"
      className={cn('flex overflow-x-auto border-b border-border', className)}
      {...props}
    >
      {children}
    </div>
  )
)
NavTabs.displayName = 'NavTabs'

interface NavTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  icon?: React.ReactNode
  /** Small muted count after the label (e.g. documents). */
  count?: number
}

const NavTab = React.forwardRef<HTMLButtonElement, NavTabProps>(
  ({ className, active, icon, count, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={-1}
      className={cn(
        `-mb-px mr-3 flex items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 py-2 text-sm transition-colors ${focusRing} [&_svg]:size-3.5 [&_svg]:shrink-0`,
        active
          ? 'border-ink font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
        className
      )}
      {...props}
    >
      {icon}
      {children}
      {count != null && <span className="tabular text-xs font-normal text-muted-foreground">{count}</span>}
    </button>
  )
)
NavTab.displayName = 'NavTab'

export { NavTabs, NavTab }
