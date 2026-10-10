import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { useInCard } from '@/shared/ui/card-context'

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
  /**
   * Inside a card, under its title: no vertical padding, so the card's own 12 px title gap and
   * 16 px padding are the only space (24 px more on top would leave 36 px under the title).
   * Defaults to whether a card is around (`Card`, `SettingsCard`, `SectionSurface`); pass `false`
   * for an empty state that stands alone inside a card (a table's body, a wide empty panel).
   */
  inCard?: boolean
}

/** Nothing to show yet: two lines of text, left-aligned, no box, no icon (design system). */
export function EmptyState({ title, body, action, titleAriaHidden, inCard: inCardProp }: EmptyStateProps) {
  const inCard = useInCard(inCardProp)
  return (
    <div className={cn('flex flex-col items-start', !inCard && 'py-6')}>
      <p aria-hidden={titleAriaHidden || undefined} className="text-sm font-medium text-foreground">
        {title}
      </p>
      {body && <p className="mt-0.5 max-w-[420px] text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
