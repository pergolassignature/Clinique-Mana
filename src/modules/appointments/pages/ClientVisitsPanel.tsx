import { useParams } from 'react-router-dom'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { formatClinicDateFull, formatClinicTime } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { ClientVisit } from '../api/visits'
import { useClientVisits } from '../hooks/use-visits'
import { modeLabel, presenceLabel, stateBadgeVariant, stateLabel } from '../lib/display'

const V = 'modules.appointments.visits'

/**
 * Rendez-vous' panel in Clients' « Visites et paiements » (slot `client.visits`, R5, AP-24): the
 * client's appointments, coming ones first (soonest first), then the past (newest first), each
 * with its professional, service, state and her presence; « Afficher plus » pages through the
 * past. The record's id comes from the route (`/clients/:id/…`).
 */
export function ClientVisitsPanel() {
  const { id = '' } = useParams()
  const visits = useClientVisits(id)
  if (visits.isError) return <LoadError message={t(`${V}.loadError`)} onRetry={() => void visits.refetch()} retrying={visits.isFetching} />
  if (!visits.data) return <Loading />
  const all = visits.data.pages.flat()
  const now = Date.now()
  const coming = all.filter((v) => Date.parse(v.startsAt) >= now).reverse()
  const past = all.filter((v) => Date.parse(v.startsAt) < now)
  return (
    <section className="space-y-4" aria-label={t(`${V}.title`)}>
      <h2 className="text-base font-semibold">{t(`${V}.title`)}</h2>
      {all.length === 0 ? (
        <EmptyState title={t(`${V}.empty`)} />
      ) : (
        <>
          <VisitList title={t(`${V}.coming`, { count: String(coming.length) })} visits={coming} empty={t(`${V}.noneComing`)} />
          <VisitList title={t(`${V}.past`)} visits={past} empty={t(`${V}.nonePast`)} />
          {visits.hasNextPage && (
            <Button type="button" variant="outline" onClick={() => void visits.fetchNextPage()} aria-disabled={visits.isFetchingNextPage || undefined}>
              {t(`${V}.more`)}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

function VisitList({ title, visits, empty }: { title: string; visits: readonly ClientVisit[]; empty: string }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm" aria-label={title}>
          {visits.map((v) => (
            <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0">
                <span className={v.state === 'cancelled' ? 'line-through' : 'font-medium'}>
                  {formatClinicDateFull(v.startsAt)}, {formatClinicTime(v.startsAt)}
                </span>
                <span className="text-muted-foreground">
                  {' · '}
                  {v.professionalName}
                  {v.serviceName && ` · ${v.serviceName}`}
                  {` · ${modeLabel(v.mode)}`}
                </span>
                {v.state === 'cancelled' && v.cancelReason && (
                  <span className="block text-xs text-muted-foreground">
                    {v.cancelLate ? t(`${V}.cancelledLate`, { reason: v.cancelReason }) : t(`${V}.cancelled`, { reason: v.cancelReason })}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <Badge variant={stateBadgeVariant(v.state)}>{stateLabel(v.state)}</Badge>
                {v.state !== 'cancelled' && v.presence !== 'expected' && (
                  <Badge variant={v.presence === 'absent' ? 'warning' : 'success'}>{presenceLabel(v.presence)}</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
