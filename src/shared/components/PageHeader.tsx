import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  /** Page-level buttons, aligned right (below the title on narrow screens). */
  actions?: ReactNode
}

/** A settings page's title: an h2, under the layout's h1 « Paramètres ». */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  )
}
