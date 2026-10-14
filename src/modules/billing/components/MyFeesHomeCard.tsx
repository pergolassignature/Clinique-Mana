import { t } from '@/i18n'
import { HomeQueueCard } from '@/shared/components/HomeQueueCard'
import { useFeeDecisions } from '../hooks/use-follow-up'

const H = 'modules.billing.home'

/**
 * Accueil « Frais d'annulation à décider » for a professional (billing.self, R-59): her late
 * cancellations and absences waiting for her decision, a link to the panel under « Mon agenda »
 * (`#frais`). Nothing when there is none, so a calm day stays calm.
 */
export function MyFeesHomeCard() {
  const fees = useFeeDecisions('pending')
  return (
    <HomeQueueCard
      title={t(`${H}.mineTitle`)}
      body={t(`${H}.mineBody`)}
      items={[{ key: 'fees', count: fees.data?.length ?? 0, label: t(`${H}.items.myFees`), to: '/mon-agenda#frais' }]}
    />
  )
}
