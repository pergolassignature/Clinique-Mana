import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  /** Page-level buttons, aligned right (below the title on narrow screens). */
  actions?: ReactNode
  /** 1 for a page with no layout heading above it (e.g. « Mon compte »); 2 by default. */
  level?: 1 | 2
  /**
   * The subtitle wraps at the header's width instead of a reading measure (`max-w-prose`): for a
   * page whose header stands over wider content, so the text lines up with what is below it.
   */
  fullWidthDescription?: boolean
}

/**
 * A page's title row: an h2 (under the layout's h1, e.g. « Paramètres ») or, with `level={1}`, the
 * page's h1; 20/28 semibold, a 13px secondary subtitle, actions aligned right and to the bottom
 * (they wrap under the title on narrow screens).
 */
export function PageHeader({ title, description, actions, level = 2, fullWidthDescription = false }: PageHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className={fullWidthDescription ? 'min-w-0 flex-1' : 'min-w-0'}>
        {/* Focusable (not tabbable) so a layout can move focus to the page it just opened. */}
        <Heading tabIndex={-1} className="text-xl font-semibold tracking-tight text-foreground outline-none">{title}</Heading>
        {description && <p className={cn('mt-0.5 text-sm text-muted-foreground', !fullWidthDescription && 'max-w-prose')}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
}
