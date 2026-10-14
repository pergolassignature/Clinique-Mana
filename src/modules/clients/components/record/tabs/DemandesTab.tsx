import { Suspense } from 'react'
import { useModuleSlot } from '@/core/modules/slots'
import { Loading } from '@/shared/components/LoadState'
import { RouteBoundary } from '@/shared/components/RouteBoundary'

/**
 * « Demandes »: the panels other modules add to the slot `client.demandes` (Demandes' list of the
 * file's requests, its own or as a participant; audit L18), each reading the record's id from the
 * route. Clients never imports them; the tab itself shows only when a panel is there (Demandes
 * enabled and the user reading requests).
 */
export function DemandesTab() {
  const panels = useModuleSlot('client.demandes')
  return (
    <div className="space-y-6">
      {panels.map(({ id, component: Panel }) => (
        <RouteBoundary key={id} scope={`client.demandes:${id}`} compact>
          <Suspense fallback={<Loading />}>
            <Panel />
          </Suspense>
        </RouteBoundary>
      ))}
    </div>
  )
}
