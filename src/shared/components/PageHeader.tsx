import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  /** Page-level buttons, aligned right (below the title on narrow screens). */
  actions?: ReactNode
  /** 1 for a page with no layout heading above it (e.g. « Mon compte »); 2 by default. */
  level?: 1 | 2
}

/**
 * A page's title row: an h2 (under the layout's h1, e.g. « Paramètres ») or, with `level={1}`, the
 * page's h1; 20/28 semibold, a 13px secondary subtitle, actions aligned right and to the bottom
 * (they wrap under the title on narrow screens).
 */
export function PageHeader({ title, description, actions, level = 2 }: PageHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Heading className="text-xl font-semibold tracking-tight text-foreground">{title}</Heading>
        {description && <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
}
