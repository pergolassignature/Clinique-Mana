import { Link, useParams } from 'react-router-dom'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { StatusDot } from '@/shared/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { useClientDemandes } from '../hooks/use-demandes'
import { demandePath, optionLabel, stateLabel, stateTone } from '../lib/display'

const C = 'modules.demandes.clientPanel'

/**
 * Clients' record, tab « Demandes » (slot `client.demandes`, demandes.view; audit L18, D-46): the
 * file's requests, its own and those where it is a participant, newest first — the number (to the
 * request), received, state (with the closing reason), her role, the matched professional.
 */
export function ClientDemandesPanel() {
  const { id = '' } = useParams()
  const list = useClientDemandes(id)
  if (list.isError && !list.data) return <LoadError message={t(`${C}.loadError`)} retrying={list.isFetching} onRetry={() => void list.refetch()} />
  if (!list.data) return <Loading />
  if (list.data.length === 0) return <EmptyState title={t(`${C}.empty`)} />
  return (
    <Table aria-label={t(`${C}.title`)} scrollLabel={t(`${C}.title`)}>
      <TableHeader>
        <TableRow className="[&>th]:whitespace-nowrap">
          <TableHead>{t(`${C}.columns.reference`)}</TableHead>
          <TableHead>{t(`${C}.columns.received`)}</TableHead>
          <TableHead>{t(`${C}.columns.state`)}</TableHead>
          <TableHead className="max-sm:hidden">{t(`${C}.columns.role`)}</TableHead>
          <TableHead className="max-md:hidden">{t(`${C}.columns.professional`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.data.map((d) => (
          <TableRow key={d.id}>
            <TableCell>
              <Link to={demandePath(d.id)} className="tabular font-medium text-link underline-offset-2 hover:underline">
                {d.reference}
              </Link>
            </TableCell>
            <TableCell className="tabular whitespace-nowrap">{formatClinicDateShort(d.received_at)}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone={stateTone(d.state)} />
                {d.state === 'closed' && d.closed_reason
                  ? t(`${C}.closedBecause`, { reason: optionLabel('closedReason', d.closed_reason) })
                  : stateLabel(d.state)}
              </span>
            </TableCell>
            <TableCell className="max-sm:hidden">{t(`${C}.role.${d.role}`)}</TableCell>
            <TableCell className="max-md:hidden">{d.matched_professional_name ?? ''}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
