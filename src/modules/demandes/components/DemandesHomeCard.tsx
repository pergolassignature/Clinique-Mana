import { t } from '@/i18n'
import { HomeQueueCard } from '@/shared/components/HomeQueueCard'
import { useInboxCounts } from '../hooks/use-demandes'

const H = 'modules.demandes.home'

/**
 * Accueil « Demandes à traiter » (L29, demandes.manage): the work queue of the counselors, each
 * figure a link to the inbox filtered on it (its URL words) — late (2 business days without a
 * contact), without an answer, to call back now, without a counselor, and mine. Only what is not
 * zero; nothing at all when the queue is clear (« à moi » alone is not work to flag) or the counts
 * cannot be read (the inbox still says it). The counts are the inbox's (`demandes_counts`), from
 * its cache, never polled.
 */
export function DemandesHomeCard() {
  const { data } = useInboxCounts()
  if (!data) return null
  if (data.late + data.no_answer + data.due + data.unassigned === 0) return null
  return (
    <HomeQueueCard
      title={t(`${H}.title`)}
      body={t(`${H}.body`, { count: String(data.open) })}
      items={[
        { key: 'late', count: data.late, label: t(`${H}.items.late`), to: '/demandes?filtres=en-retard' },
        { key: 'no_answer', count: data.no_answer, label: t(`${H}.items.no_answer`), to: '/demandes?filtres=sans-reponse' },
        { key: 'due', count: data.due, label: t(`${H}.items.due`), to: '/demandes?filtres=a-rappeler' },
        { key: 'unassigned', count: data.unassigned, label: t(`${H}.items.unassigned`), to: '/demandes?pour=personne' },
        { key: 'mine', count: data.mine, label: t(`${H}.items.mine`), to: '/demandes?pour=moi' },
      ]}
    />
  )
}
