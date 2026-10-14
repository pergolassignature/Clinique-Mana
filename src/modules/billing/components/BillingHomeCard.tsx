import { t } from '@/i18n'
import { HomeQueueCard } from '@/shared/components/HomeQueueCard'
import { useOverdueInvoices } from '../hooks/use-follow-up'
import { usePayerQueue } from '../hooks/use-payers'
import { useMorningQueue } from '../hooks/use-queue'
import { useInteracNotices } from '../hooks/use-stripe'

const H = 'modules.billing.home'

/**
 * Accueil « Facturation à traiter » (L29, billing.view): the morning queue's drafts ready to send
 * and those put on hold (→ « File du matin »), the unpaid invoices past their due date
 * (→ « Impayés »), the Interac notices to match (→ « Virements Interac »), the third-party payers
 * with sessions due to invoice by their cadence (→ « Payeurs tiers »). Only what is not zero; nothing when all is done
 * or the reads fail (the pages still say it). The pages' own queries, never polled.
 */
export function BillingHomeCard() {
  const queue = useMorningQueue()
  const overdue = useOverdueInvoices()
  const interac = useInteracNotices('to_match')
  const payers = usePayerQueue()
  const rows = queue.data ?? []
  return (
    <HomeQueueCard
      title={t(`${H}.title`)}
      items={[
        { key: 'ready', count: rows.filter((r) => r.holdReason === null).length, label: t(`${H}.items.ready`), to: '/facturation' },
        { key: 'held', count: rows.filter((r) => r.holdReason !== null).length, label: t(`${H}.items.held`), to: '/facturation' },
        { key: 'overdue', count: overdue.data?.length ?? 0, label: t(`${H}.items.overdue`), to: '/facturation?vue=impayes' },
        { key: 'interac', count: interac.data?.length ?? 0, label: t(`${H}.items.interac`), to: '/facturation/virements' },
        { key: 'payers', count: (payers.data ?? []).filter((g) => g.pending.some((x) => x.due)).length, label: t(`${H}.items.payers`), to: '/facturation/payeurs' },
      ]}
    />
  )
}
