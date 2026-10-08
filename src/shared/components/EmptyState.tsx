import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  /** One sentence saying what to do next. */
  body?: string
  action?: ReactNode
  /**
   * The title is also in a live region elsewhere on the page (which screen readers announce and
   * read): hide this copy from them so it is heard once.
   */
  titleAriaHidden?: boolean
}

/** Nothing to show yet: two lines of text, left-aligned, no box, no icon (design system). */
export function EmptyState({ title, body, action, titleAriaHidden }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start py-6">
      <p aria-hidden={titleAriaHidden || undefined} className="text-sm font-medium text-foreground">
        {title}
      </p>
      {body && <p className="mt-0.5 max-w-[420px] text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
