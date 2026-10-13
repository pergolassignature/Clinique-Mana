import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { formatDateOnly } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Badge } from '@/shared/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { PayoutPeriodDetail } from '../components/payroll/PayoutPeriodDetail'
import { useMyPayoutPeriods, usePayoutPeriod } from '../hooks/use-payroll'
import { formatPay, monthLabel, monthTitle, stateBadgeVariant, stateLabel } from '../lib/payroll'

const M = 'modules.billing.payroll.mine'

/**
 * « Ma paie » (`/ma-paie`, `billing.self`): the professional's monthly summaries once the
 * administration sent them (Christine 14), newest first, then one summary (`/ma-paie/:periodId`):
 * its lines, « Valider le sommaire » or « Signaler une correction », and her invoice, uploaded or
 * generated once validated. She never sees a draft, a retention grid or another's pay.
 */
export function MyPayPage() {
  const { periodId } = useParams<{ periodId?: string }>()
  return periodId ? <MyPeriod id={periodId} /> : <MyPeriods />
}

function MyPeriods() {
  usePageTitle(t(`${M}.title`))
  const periods = useMyPayoutPeriods()
  let body
  if (periods.isPending) body = <Loading />
  else if (periods.isError && !periods.data) {
    body = <LoadError message={t(`${M}.loadError`)} retrying={periods.isFetching} onRetry={() => void periods.refetch()} />
  } else if (periods.data.length === 0) body = <EmptyState title={t(`${M}.emptyTitle`)} body={t(`${M}.emptyBody`)} />
  else {
    body = (
      <Table aria-label={t(`${M}.table`)} scrollLabel={t(`${M}.table`)} scrollFocus="overflow">
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{t(`${M}.columns.month`)}</TableHead>
            <TableHead>{t(`${M}.columns.state`)}</TableHead>
            <TableHead align="right">{t(`${M}.columns.lines`)}</TableHead>
            <TableHead align="right">{t(`${M}.columns.total`)}</TableHead>
            <TableHead>{t(`${M}.columns.invoice`)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.data.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                <Link to={`/ma-paie/${p.id}`} className="underline-offset-2 hover:underline">
                  {monthTitle(p.month)}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={stateBadgeVariant(p.state)}>{stateLabel(p.state)}</Badge>
                {p.paid_on && <span className="block text-xs text-muted-foreground">{t(`${M}.paidOn`, { date: formatDateOnly(p.paid_on) })}</span>}
              </TableCell>
              <TableCell align="right">{p.lines_count}</TableCell>
              <TableCell align="right" className="whitespace-nowrap">{formatPay(p.total_cents)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {p.has_invoice ? t(`${M}.invoiceAttached`) : p.state === 'validated' ? t(`${M}.invoiceToAttach`) : t(`${M}.invoiceNotYet`)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${M}.title`)} description={t(`${M}.description`)} />
      {body}
    </div>
  )
}

function MyPeriod({ id }: { id: string }) {
  const period = usePayoutPeriod(id)
  const title = period.data ? t(`${M}.periodTitle`, { month: monthLabel(period.data.month) }) : t(`${M}.title`)
  usePageTitle(title)
  let body
  if (period.isPending) body = <Loading />
  else if (period.isError && !period.data) {
    body = <LoadError message={t(`${M}.periodLoadError`)} retrying={period.isFetching} onRetry={() => void period.refetch()} />
  } else body = <PayoutPeriodDetail period={period.data} audience="professional" />
  return (
    <div className="max-w-content space-y-5">
      <Link to="/ma-paie" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft aria-hidden className="h-4 w-4" />
        {t(`${M}.back`)}
      </Link>
      <PageHeader level={1} title={title} description={t(`${M}.periodDescription`)} />
      {body}
    </div>
  )
}
