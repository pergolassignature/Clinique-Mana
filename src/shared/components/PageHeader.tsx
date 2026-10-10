import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  /**
   * The list's count, first on the subtitle line (« 10 professionnels · 7 actifs »), tabular. The one
   * place a list says how many it holds; the table footer repeats it only when filtered.
   */
  count?: ReactNode
  /**
   * Page-level buttons, right of the title, centred on the title's line (below the title on narrow
   * screens). At most one teal button per screen; 32 px buttons (default size).
   */
  actions?: ReactNode
  /**
   * 1 for a page title, 20/28: a page with no layout heading above it (« Mon compte »), and a
   * settings section (decision UI-4: the section title is the page's H1). 2 by default, for a
   * section under a layout heading: the section title, 16/24.
   */
  level?: 1 | 2
  /**
   * The subtitle wraps at the header's width instead of a reading measure (`max-w-prose`): for a
   * page whose header stands over wider content, so the text lines up with what is below it.
   */
  fullWidthDescription?: boolean
}

/**
 * A page's title row: with `level={1}` the page's h1 (20/28), else an h2 (16/24); a 13 px secondary
 * subtitle (the count first); actions on the right, vertically centred on the title's line, not on
 * the subtitle (audit 2026-10-09 finding 10). They wrap under the title on narrow screens.
 */
export function PageHeader({ title, description, count, actions, level = 2, fullWidthDescription = false }: PageHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  const subtitle = count != null || description
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className={fullWidthDescription ? 'min-w-0 flex-1' : 'min-w-0'}>
        {/* Focusable (not tabbable) so a layout can move focus to the page it just opened. */}
        <Heading
          tabIndex={-1}
          className={cn('font-semibold text-foreground outline-none', level === 1 ? 'text-xl tracking-tight' : 'text-lg')}
        >
          {title}
        </Heading>
        {subtitle && (
          <p className={cn('mt-0.5 text-sm text-muted-foreground', !fullWidthDescription && 'max-w-prose')}>
            {count != null && <span className="tabular">{count}</span>}
            {count != null && description && ' · '}
            {description}
          </p>
        )}
      </div>
      {/* The box is the title's line height (28 / 24): the buttons are centred on that line. */}
      {actions && <div className={cn('flex shrink-0 items-center gap-1.5', level === 1 ? 'h-7' : 'h-6')}>{actions}</div>}
    </div>
  )
}
