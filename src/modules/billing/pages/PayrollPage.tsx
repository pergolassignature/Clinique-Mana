import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { useUrlParams } from '@/shared/lib/use-url-params'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { toast } from '@/shared/ui/sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { listPayoutExport, type PayoutPeriodRow } from '../api/payroll'
import { payrollErrorMessage } from '../api/payroll-errors'
import { PayoutPeriodDetail } from '../components/payroll/PayoutPeriodDetail'
import { useBuildPayoutMonth, useDiscardPayoutDrafts, usePayoutMonth, usePayoutPeriod, useSendPayoutPeriods } from '../hooks/use-payroll'
import {
  currentMonth,
  exportCsv,
  formatPay,
  lastFinishedMonth,
  monthFromParam,
  monthParam,
  monthSummary,
  monthTitle,
  nextMonth,
  previousMonth,
  stateBadgeVariant,
  stateLabel,
} from '../lib/payroll'

const A = 'modules.billing.payroll.admin'

/**
 * « Paie » (`/facturation/paie?mois=AAAA-MM&periode=…`, `billing.payroll`): a month's summaries,
 * one per professional (Christine 14). « Calculer le mois » builds or rebuilds a finished month
 * (the job does it on the 1st); each summary is checked, then « Envoyer » to its professional (a
 * line to complete keeps it back); she validates and attaches her invoice; « Marquer comme
 * versée ». « Exporter pour QuickBooks » gives the month's invoices by specialty (FQ will push
 * them). A summary opens in a side sheet.
 */
export function PayrollPage() {
  const { params, update } = useUrlParams()
  const month = monthFromParam(params.get('mois')) ?? lastFinishedMonth()
  const periodId = params.get('periode')
  usePageTitle(t(`${A}.title`))
  const periods = usePayoutMonth(month)
  const build = useBuildPayoutMonth()
  const send = useSendPayoutPeriods()
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [confirm, setConfirm] = useState<null | 'rebuild' | 'discard'>(null)
  const discard = useDiscardPayoutDrafts()
  const finished = month < currentMonth()

  const go = (next: { mois?: string; periode?: string | null }) =>
    update(
      { ...(next.mois ? { mois: next.mois } : {}), ...(next.periode !== undefined ? { periode: next.periode } : {}) },
      { replace: next.periode !== undefined },
    )

  const runBuild = () => {
    if (build.isPending) return
    setError(null)
    build.mutateAsync(month).then(
      (r) => toast.success(t(`${A}.toasts.built`, { created: String(r.created), rebuilt: String(r.rebuilt), locked: String(r.locked) })),
      (failure: unknown) => setError(payrollErrorMessage(failure)),
    )
  }

  const rows = periods.data ?? []
  const summary = monthSummary(rows)
  const ready = rows.filter((r) => (r.state === 'draft' || r.state === 'correction_requested') && r.unpriced_count === 0)
  const sentOpen = rows.filter((r) => r.state === 'to_validate').length
  const neverSent = rows.filter((r) => r.state === 'draft' && r.sent_at === null).length

  const runDiscard = () => {
    if (discard.isPending) return
    setError(null)
    discard.mutateAsync(month).then(
      (count) => toast.success(t(`${A}.toasts.discarded`, { count: String(count) })),
      (failure: unknown) => setError(payrollErrorMessage(failure)),
    )
  }

  const runSend = () => {
    if (send.isPending || ready.length === 0) return
    setError(null)
    send.mutateAsync(ready.map((r) => r.id)).then(
      (r) => toast.success(t(`${A}.toasts.sent`, { sent: String(r.sent), unpriced: String(r.unpriced) })),
      (failure: unknown) => setError(payrollErrorMessage(failure)),
    )
  }

  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    setError(null)
    try {
      const rows = await listPayoutExport(month)
      if (rows.length === 0) {
        setError(t(`${A}.exportEmpty`))
        return
      }
      const blob = new Blob([exportCsv(rows)], { type: 'text/csv;charset=utf-8' })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = t(`${A}.exportFileName`, { month: monthParam(month) })
      link.click()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch (failure) {
      setError(payrollErrorMessage(failure))
    } finally {
      setExporting(false)
    }
  }

  let body
  if (periods.isPending) body = <Loading />
  else if (periods.isError && !periods.data) {
    body = <LoadError message={t(`${A}.loadError`)} retrying={periods.isFetching} onRetry={() => void periods.refetch()} />
  } else if (rows.length === 0) {
    body = <EmptyState title={t(`${A}.emptyTitle`)} body={t(finished ? `${A}.emptyBody` : `${A}.emptyBodyUnfinished`)} />
  } else {
    body = <PeriodsTable rows={rows} onOpen={(id) => go({ periode: id })} />
  }

  return (
    <div className="max-w-content space-y-5">
      <PageHeader
        level={1}
        title={t(`${A}.title`)}
        description={t(`${A}.description`)}
        actions={
          <div className="flex flex-wrap gap-2">
            {finished && (
              <Button
                type="button"
                variant={rows.length === 0 ? 'default' : 'outline'}
                aria-disabled={build.isPending || undefined}
                onClick={() => (sentOpen > 0 ? setConfirm('rebuild') : runBuild())}
              >
                {build.isPending ? t(`${A}.building`) : rows.length === 0 ? t(`${A}.build`) : t(`${A}.rebuild`)}
              </Button>
            )}
            {ready.length > 0 && (
              <Button type="button" aria-disabled={send.isPending || undefined} onClick={runSend}>
                {t(`${A}.sendReady`, { count: String(ready.length) })}
              </Button>
            )}
            {neverSent > 0 && (
              <Button type="button" variant="outline" aria-disabled={discard.isPending || undefined} onClick={() => !discard.isPending && setConfirm('discard')}>
                {t(`${A}.discard`, { count: String(neverSent) })}
              </Button>
            )}
            {summary.validated + summary.paid > 0 && (
              <Button type="button" variant="outline" aria-disabled={exporting || undefined} onClick={() => void runExport()}>
                <Download aria-hidden className="h-4 w-4" />
                {t(`${A}.export`)}
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="icon" aria-label={t(`${A}.previousMonth`)} onClick={() => go({ mois: monthParam(previousMonth(month)) })}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </Button>
        <h2 className="min-w-[10rem] text-center text-base font-semibold" aria-live="polite">
          {monthTitle(month)}
        </h2>
        <Button type="button" variant="outline" size="icon" aria-label={t(`${A}.nextMonth`)} onClick={() => go({ mois: monthParam(nextMonth(month)) })}>
          <ChevronRight aria-hidden className="h-4 w-4" />
        </Button>
        {rows.length > 0 && (
          <p className="ml-2 text-sm text-muted-foreground">
            {t(`${A}.summary`, {
              periods: String(summary.periods),
              total: formatPay(summary.totalCents),
              unpriced: String(summary.unpriced),
              validated: String(summary.validated),
              paid: String(summary.paid),
            })}
          </p>
        )}
      </div>
      {error && <RefusalAlert message={error} />}
      {body}
      <PeriodSheet id={periodId} onClose={() => go({ periode: null })} />
      {confirm && (
        <AlertDialog open onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${A}.confirm.${confirm}.title`, { month: monthTitle(month) })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(`${A}.confirm.${confirm}.body`, { count: String(confirm === 'rebuild' ? sentOpen : neverSent) })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => (confirm === 'rebuild' ? runBuild() : runDiscard())}>
                {t(`${A}.confirm.${confirm}.action`)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

function PeriodsTable({ rows, onOpen }: { rows: readonly PayoutPeriodRow[]; onOpen: (id: string) => void }) {
  return (
    <Table aria-label={t(`${A}.table`)} scrollLabel={t(`${A}.table`)} scrollFocus="overflow">
      <TableHeader>
        <TableRow className="[&>th]:whitespace-nowrap">
          <TableHead>{t(`${A}.columns.professional`)}</TableHead>
          <TableHead className="max-md:hidden">{t(`${A}.columns.specialty`)}</TableHead>
          <TableHead>{t(`${A}.columns.state`)}</TableHead>
          <TableHead align="right" className="max-sm:hidden">{t(`${A}.columns.lines`)}</TableHead>
          <TableHead align="right">{t(`${A}.columns.total`)}</TableHead>
          <TableHead className="max-sm:hidden">{t(`${A}.columns.invoice`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onOpen(r.id)}>
                {r.professional_name ?? t(`${A}.unknownProfessional`)}
              </button>
            </TableCell>
            <TableCell className="text-sm max-md:hidden">{r.title_name ?? t(`${A}.noSpecialty`)}</TableCell>
            <TableCell>
              <Badge variant={stateBadgeVariant(r.state)}>{stateLabel(r.state)}</Badge>
              {r.unpriced_count > 0 && (
                <span className="block">
                  <Badge variant="warning">{t(`${A}.unpriced`, { count: String(r.unpriced_count) })}</Badge>
                </span>
              )}
            </TableCell>
            <TableCell align="right" className="max-sm:hidden">{r.lines_count}</TableCell>
            <TableCell align="right" className="whitespace-nowrap">{formatPay(r.total_cents)}</TableCell>
            <TableCell className="text-sm text-muted-foreground max-sm:hidden">{r.invoice_number ?? t(`${A}.noInvoice`)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PeriodSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const period = usePayoutPeriod(id)
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>
            {period.data ? t(`${A}.sheetTitle`, { name: period.data.professional?.display_name ?? '', month: monthTitle(period.data.month) }) : t(`${A}.title`)}
          </SheetTitle>
          <SheetDescription>{t(`${A}.sheetDescription`)}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {period.isPending ? (
            <Loading />
          ) : period.isError && !period.data ? (
            <LoadError message={t(`${A}.periodLoadError`)} retrying={period.isFetching} onRetry={() => void period.refetch()} />
          ) : (
            <PayoutPeriodDetail period={period.data} audience="staff" />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
