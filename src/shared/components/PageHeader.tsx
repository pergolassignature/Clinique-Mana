import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  /** Page-level buttons, aligned right (below the title on narrow screens). */
  actions?: ReactNode
}

/**
 * A page's title row: an h2 (under the layout's h1, e.g. « Paramètres ») at 20/28 semibold,
 * a 13px secondary subtitle, actions aligned right and to the bottom (they wrap under the title
 * on narrow screens).
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {/* Focusable (not tabbable) so a layout can move focus to the page it just opened. */}
        <h2 tabIndex={-1} className="text-xl font-semibold tracking-tight text-foreground outline-none">{title}</h2>
        {description && <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
}
