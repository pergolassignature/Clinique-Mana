import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  /** Page-level buttons, aligned right (below the title on narrow screens). */
  actions?: ReactNode
  /**
   * 1 for a page with no layout heading above it (e.g. « Mon compte »): the page title, 20/28.
   * 2 by default, for a section under a layout heading (the settings sections under
   * « Paramètres »): the section title, 16/24, so the two levels read as two levels.
   */
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
        <Heading
          tabIndex={-1}
          className={cn('font-semibold text-foreground outline-none', level === 1 ? 'text-xl tracking-tight' : 'text-lg')}
        >
          {title}
        </Heading>
        {description && <p className={cn('mt-0.5 text-sm text-muted-foreground', !fullWidthDescription && 'max-w-prose')}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
}
