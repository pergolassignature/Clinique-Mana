import { t } from '@/i18n'
import { HomeQueueCard } from '@/shared/components/HomeQueueCard'
import { useConsentsToObtain } from '../hooks/use-consents'

const H = 'modules.clients.consents.home'

/**
 * Accueil « Consentements à obtenir » (L29, clients.view): the consent requests still waiting for a
 * signature, those past their due date first, each figure to « Consentements à obtenir ». Only
 * what is not zero; nothing when none waits or the read fails (the page still says it). The
 * page's own query, never polled.
 */
export function ConsentsHomeCard() {
  const { data } = useConsentsToObtain()
  if (!data) return null
  const overdue = data.rows.filter((r) => r.isOverdue).length
  return (
    <HomeQueueCard
      title={t(`${H}.title`)}
      items={[
        { key: 'overdue', count: overdue, label: t(`${H}.items.overdue`), to: '/clients/consentements' },
        { key: 'waiting', count: data.total - overdue, label: t(`${H}.items.waiting`), to: '/clients/consentements' },
      ]}
    />
  )
}
