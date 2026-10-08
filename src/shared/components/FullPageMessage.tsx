import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface FullPageMessageProps {
  title: string
  body?: string
  action?: ReactNode
  /** ARIA live role for the wrapper, e.g. 'alert' for error fallbacks. */
  role?: 'alert' | 'status'
  /** 2 when the message sits under an existing page title (e.g. inside the settings pane). */
  headingLevel?: 1 | 2
  /** Pane-sized instead of filling the viewport. */
  compact?: boolean
}

/** Centred text state for not-found, forbidden and module errors (no icon, no box). */
export function FullPageMessage({ title, body, action, role, headingLevel = 1, compact = false }: FullPageMessageProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <div role={role} className={cn('flex items-center justify-center px-4', compact ? 'py-12' : 'min-h-[60vh]')}>
      <div className="max-w-sm text-center">
        <Heading className={cn('font-semibold text-foreground', compact ? 'text-base' : 'text-lg')}>{title}</Heading>
        {body && <p className="mt-2 text-sm text-muted-foreground">{body}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  )
}
