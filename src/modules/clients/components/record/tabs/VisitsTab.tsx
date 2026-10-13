import { Suspense } from 'react'
import { t } from '@/i18n'
import { useModuleSlot } from '@/core/modules/slots'
import { EmptyState } from '@/shared/components/EmptyState'
import { Loading } from '@/shared/components/LoadState'
import { RouteBoundary } from '@/shared/components/RouteBoundary'

/**
 * « Visites et paiements »: the panels other modules add to the slot `client.visits` (Rendez-vous's
 * appointments, R5; Facturation's payments, F2), each reading the record's id from the route.
 * Clients never imports them: the shell hands over the enabled modules' panels the user may see.
 * With none, it says where the history lives today (GOrendezvous), plainly.
 */
export function VisitsTab() {
  const panels = useModuleSlot('client.visits')
  if (panels.length === 0) {
    return <EmptyState title={t('modules.clients.record.visits.title')} body={t('modules.clients.record.visits.body')} />
  }
  return (
    <div className="space-y-6">
      {panels.map(({ id, component: Panel }) => (
        <RouteBoundary key={id} scope={`client.visits:${id}`} compact>
          <Suspense fallback={<Loading />}>
            <Panel />
          </Suspense>
        </RouteBoundary>
      ))}
    </div>
  )
}
