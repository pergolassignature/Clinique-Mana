import { useId, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

type HeadingTag = 'h2' | 'h3' | 'h4'

interface SectionHeadingProps {
  /** The heading level in the page's outline: `h2` under the page's H1 (default), `h3` inside a card. */
  as?: HeadingTag
  id?: string
  /** One short line under the heading (12 px secondary), e.g. what the group holds. */
  description?: ReactNode
  /** At most one small action on the right of the heading line (a ghost or outline `Button`). */
  action?: ReactNode
  className?: string
  children: ReactNode
}

/** The overline recipe (typography-and-spacing.md §2): 11/16, 500, caps, +0.06em, secondary. */
const OVERLINE = 'text-2xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * The heading of a group of cards, of a list or of a block inside a card (« Documents requis »,
 * « En bref »): the overline, never a 16/600 H3 inside a tab (audit 2026-10-09 §2.2, §2.4). It adds
 * no margin of its own: `SectionGroup` puts it 8 px above its group.
 */
export function SectionHeading({ as: Tag = 'h2', id, description, action, className, children }: SectionHeadingProps) {
  const heading = (
    <div className="min-w-0">
      <Tag id={id} className={OVERLINE}>
        {children}
      </Tag>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
  )
  if (!action) return <div className={className}>{heading}</div>
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      {heading}
      <div className="flex shrink-0 items-center gap-2">{action}</div>
    </div>
  )
}

interface SectionGroupProps extends Omit<SectionHeadingProps, 'id' | 'children'> {
  title: ReactNode
  children: ReactNode
}

/**
 * A named group of cards: a `<section>` labelled by its `SectionHeading`, the heading 8 px above
 * the group, the group's cards 20 px apart. Groups follow each other 32 px apart: put them in a
 * `flex flex-col gap-8` stack (the gap between two things is smaller than the gap around their
 * group, typography-and-spacing.md §3).
 */
export function SectionGroup({ title, as, description, action, className, children }: SectionGroupProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn('min-w-0', className)}>
      <SectionHeading as={as} id={headingId} description={description} action={action} className="mb-2">
        {title}
      </SectionHeading>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  )
}
