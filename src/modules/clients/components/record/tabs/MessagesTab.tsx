import { Suspense } from 'react'
import { t } from '@/i18n'
import { useModuleSlot } from '@/core/modules/slots'
import { EmptyState } from '@/shared/components/EmptyState'
import { Loading } from '@/shared/components/LoadState'
import { RouteBoundary } from '@/shared/components/RouteBoundary'

/**
 * « Courriels »: the panels other modules add to the slot `client.messages` (Communications'
 * linked threads and « Écrire un courriel », CM3), each reading the record's id from the route.
 * Clients never imports them, as « Visites et paiements ». With none, it says so plainly.
 */
export function MessagesTab() {
  const panels = useModuleSlot('client.messages')
  if (panels.length === 0) {
    return <EmptyState title={t('modules.clients.record.messages.title')} body={t('modules.clients.record.messages.body')} />
  }
  return (
    <div className="space-y-6">
      {panels.map(({ id, component: Panel }) => (
        <RouteBoundary key={id} scope={`client.messages:${id}`} compact>
          <Suspense fallback={<Loading />}>
            <Panel />
          </Suspense>
        </RouteBoundary>
      ))}
    </div>
  )
}
