import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Badge } from '@/shared/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { usePayersToComplete } from '../hooks/use-clients'
import { clientPath } from '../lib/constants'
import { payerKindLabel } from '../lib/display'

const S = 'modules.clients.payersToComplete'

/**
 * « Payeurs à compléter » (`/clients/payeurs-a-completer`, `clients.view`, FP-9): the active IVAC
 * and PAE payers Facturation cannot split a session with yet, the import's ones first in name
 * order (a GOrendezvous tag became a payer to complete: its file number is not in the exports).
 * Each row says what is missing and opens the dossier's « Assurance et payeurs »; until it is
 * completed, the dossier's drafts wait in the morning queue (never billed in full by mistake).
 */
export function PayersToCompletePage() {
  usePageTitle(t(`${S}.title`))
  const list = usePayersToComplete()
  const rows = list.data
  return (
    <div className="space-y-4">
      <PageHeader level={1} title={t(`${S}.title`)} count={rows?.length} description={t(`${S}.description`)} />
      {list.isError && !rows ? (
        <LoadError message={t(`${S}.loadError`)} retrying={list.isFetching} onRetry={() => void list.refetch()} />
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState title={t(`${S}.empty`)} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table aria-label={t(`${S}.title`)} scrollLabel={t(`${S}.title`)}>
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${S}.columns.client`)}</TableHead>
                <TableHead>{t(`${S}.columns.payer`)}</TableHead>
                <TableHead>{t(`${S}.columns.missing`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.clientPayerId}>
                  <TableCell className="font-medium">
                    <Link to={clientPath(row.clientId, 'assurance-et-payeurs')} className="text-primary underline-offset-2 hover:underline">
                      {row.clientName}
                    </Link>
                    {row.clientNumber !== null && <span className="tabular block text-xs font-normal text-muted-foreground">{t(`${S}.number`, { number: String(row.clientNumber) })}</span>}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {payerKindLabel(row.kind)}
                      {row.isStub && <Badge variant="warning">{t(`${S}.stub`)}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>{row.missing.length > 0 ? row.missing.map((m) => t(`${S}.missing.${m}`)).join(', ') : t(`${S}.checkTerms`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
