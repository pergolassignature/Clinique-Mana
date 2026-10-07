import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { StatusDot, type StatusTone } from './status-dot'

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'error' | 'info'

const dotTone: Record<BadgeVariant, StatusTone> = {
  default: 'default',
  secondary: 'neutral',
  outline: 'neutral',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Sets the dot colour. */
  variant?: BadgeVariant
  /** Leading 6px status dot (default true). */
  dot?: boolean
  /**
   * The one filled exception (« Urgent »): red with `error`, ink otherwise; white 11px text.
   * Use sparingly, one per row at most.
   */
  filled?: boolean
}

/**
 * Status as text: a 6px dot and a word, 12px medium secondary text. No pill, no fill
 * (except `filled`). The word carries the meaning; the dot is decorative.
 */
function Badge({ className, variant = 'default', dot = true, filled = false, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium text-muted-foreground',
        filled &&
          cn(
            'rounded-sm px-[5px] text-2xs font-semibold tracking-[0.02em] text-white',
            variant === 'error' ? 'bg-destructive' : 'bg-ink',
          ),
        className,
      )}
      {...props}
    >
      {dot && !filled && <StatusDot tone={dotTone[variant]} />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

export { Badge }
