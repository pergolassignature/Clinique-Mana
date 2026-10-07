import * as React from 'react'
import { cn } from '@/shared/lib/utils'

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
      className={cn('flex', className)}
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
}

const NavTab = React.forwardRef<HTMLButtonElement, NavTabProps>(
  ({ className, active, icon, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={-1}
      className={cn(
        'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
        active
          ? 'border-sage-500 text-sage-700'
          : 'border-transparent text-foreground-muted hover:text-foreground hover:border-border',
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
)
NavTab.displayName = 'NavTab'

export { NavTabs, NavTab }
