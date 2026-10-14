import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/shared/ui/button'

export interface HomeQueueItem {
  /** Stable key (React). */
  key: string
  count: number
  /** What the count is, after the number: « en retard », « à rapprocher ». */
  label: string
  /** The module's list, already filtered on it. */
  to: string
}

/**
 * An Accueil work-queue card (`homeCards`, the convention of docs/modules/core.md « Accueil
 * cards »): a heading, one line, and each figure that is not zero as a link to the list filtered on
 * it, the number first. Renders nothing when every figure is zero, so a calm day stays calm.
 */
export function HomeQueueCard({ title, body, items }: { title: string; body?: string; items: readonly HomeQueueItem[] }) {
  const headingId = useId()
  const shown = items.filter((item) => item.count > 0)
  if (shown.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-4">
      <h2 id={headingId} className="text-base font-semibold text-foreground">
        {title}
      </h2>
      {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
      <ul className="mt-3 flex flex-wrap gap-2">
        {shown.map((item) => (
          <li key={item.key}>
            <Button asChild variant="outline" size="sm" className="max-sm:h-11">
              <Link to={item.to}>
                <span className="tabular font-semibold">{item.count}</span>
                <span>{item.label}</span>
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
