import { useState } from 'react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { StatusDot } from '@/shared/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { ConsentToObtain } from '../api/consents'
import { ClientConsentsPanel } from '../components/consents/ClientConsentsPanel'
import { useConsentsToObtain } from '../hooks/use-consents'
import { requestProgressLabel } from '../lib/consents'

const S = 'modules.clients.consents'

/**
 * « Consentements à obtenir » (Clients C5a, `clients.view`): the consent requests sent and not yet
 * signed, the overdue first, then by due date; per row the state (overdue, waiting, answers given,
 * signature started) and the last send. A row opens the client's consents in a side sheet
 * (« Renvoyer », « Annuler la demande », the other consents). No timer: the list reloads on mount
 * and after an action. The count is the total, even past the rows shown.
 */
export function ConsentsToObtainPage() {
  usePageTitle(t(`${S}.title`))
  const list = useConsentsToObtain()
  const [open, setOpen] = useState<ConsentToObtain | null>(null)
  const rows = list.data?.rows

  return (
    <div className="space-y-4">
      <PageHeader level={1} title={t(`${S}.title`)} count={list.data?.total} description={t(`${S}.description`)} />
      {list.isError && !rows ? (
        <LoadError message={t(`${S}.loadError`)} retrying={list.isFetching} onRetry={() => void list.refetch()} />
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState title={t(`${S}.empty.title`)} body={t(`${S}.empty.body`)} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table aria-label={t(`${S}.title`)} scrollLabel={t(`${S}.title`)}>
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${S}.columns.client`)}</TableHead>
                <TableHead>{t(`${S}.columns.consent`)}</TableHead>
                <TableHead>{t(`${S}.columns.state`)}</TableHead>
                <TableHead>{t(`${S}.columns.due`)}</TableHead>
                <TableHead className="max-sm:hidden">{t(`${S}.columns.sent`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const state = requestProgressLabel(row)
                return (
                  <TableRow key={row.requestId}>
                    <TableCell className="font-medium">
                      <Button type="button" variant="link" className="h-auto px-0 text-left" onClick={() => setOpen(row)} aria-label={t(`${S}.open`, { client: row.clientName })}>
                        {row.clientName}
                      </Button>
                    </TableCell>
                    <TableCell>{row.consentName}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
                        <StatusDot tone={state.tone} />
                        {state.label}
                      </span>
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap">{row.dueAt ? formatClinicDateShort(row.dueAt) : t(`${S}.noDue`)}</TableCell>
                    <TableCell className="tabular whitespace-nowrap text-muted-foreground max-sm:hidden">
                      {formatClinicDateShort(row.lastSentAt)}
                      {row.remindedAt && `${t(`${S}.separator`)}${t(`${S}.reminded`)}`}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{open ? t(`${S}.sheetTitle`, { client: open.clientName }) : ''}</SheetTitle>
          </SheetHeader>
          <SheetBody>{open && <ClientConsentsPanel clientId={open.clientId} />}</SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  )
}
