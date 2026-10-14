import { useId } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { useInboxCounts } from '../hooks/use-demandes'

const H = 'modules.demandes.home'

/** The inbox's filters, as its URL says them (DemandesInboxPage's FLAG_PARAM / ASSIGNED_PARAM). */
const LINKS = {
  late: '/demandes?filtres=en-retard',
  no_answer: '/demandes?filtres=sans-reponse',
  due: '/demandes?filtres=a-rappeler',
  unassigned: '/demandes?pour=personne',
  mine: '/demandes?pour=moi',
} as const
type Item = keyof typeof LINKS

/**
 * Accueil « Demandes à traiter » (L29, demandes.manage): the work queue of the counselors, each
 * figure a link to the inbox filtered on it — late (2 business days without a contact), without
 * an answer, to call back now, without a counselor, and mine. Only what is not zero; nothing at
 * all when the queue is clear or the counts cannot be read (the inbox still says it). The counts
 * are the inbox's (`demandes_counts`), read from its cache, never polled.
 */
export function DemandesHomeCard() {
  const headingId = useId()
  const { data } = useInboxCounts()
  if (!data) return null
  const values: Record<Item, number> = {
    late: data.late,
    no_answer: data.no_answer,
    due: data.due,
    unassigned: data.unassigned,
    mine: data.mine,
  }
  const work = (['late', 'no_answer', 'due', 'unassigned'] as const).filter((k) => values[k] > 0)
  if (work.length === 0) return null
  const items: Item[] = values.mine > 0 ? [...work, 'mine'] : work
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-4">
      <h2 id={headingId} className="text-base font-semibold text-foreground">
        {t(`${H}.title`)}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t(`${H}.body`, { count: String(data.open) })}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((k) => (
          <li key={k}>
            <Button asChild variant="outline" size="sm" className="max-sm:h-11">
              <Link to={LINKS[k]}>
                <span className="tabular font-semibold">{values[k]}</span>
                <span>{t(`${H}.items.${k}`)}</span>
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
