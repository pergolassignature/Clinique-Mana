import { Link } from 'react-router-dom'
import { useAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { downloadCsv } from '@/shared/lib/csv'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { PayoutsReport } from '../api/rp2'
import { FilterSelect, ReportControls, Totals } from '../components/ReportControls'
import { useReportParams } from '../hooks/use-report-params'
import { usePayoutsReport } from '../hooks/use-reports'
import { formatMoney, monthLabel, periodError } from '../lib/reports'
import { payoutStateLabel, payoutsCsv } from '../lib/rp2'

const V = 'modules.reports.payouts'

/**
 * « Paie » (`/rapports/paie`, reports.payroll; RP-8): the payroll summaries (Facturation FPay) of
 * the months the period covers: the totals (owed, paid, validated and still to pay, not validated
 * yet), per month, per professional, then each summary (sessions, late cancellations, other fees,
 * adjustments, total, its state). A summary opens in « Paie » for who runs the payroll. « Exporter
 * (CSV) » saves the summaries.
 */
export function PayoutsReportPage() {
  usePageTitle(t(`${V}.title`))
  const { params, period, today, set } = useReportParams()
  const filters = { from: period.from, to: period.to, professionalId: params.get('pro') }
  const error = periodError(period)
  const report = usePayoutsReport(filters, error === null)
  const data = error === null ? report.data : undefined

  let body
  if (error) body = null
  else if (report.isPending) body = <Loading />
  else if (report.isError && !report.data) {
    body = (
      <LoadError
        message={moduleErrorMessage(report.error, t(`${V}.loadError`), 'reports')}
        retrying={report.isFetching}
        onRetry={() => void report.refetch()}
      />
    )
  } else if (data) body = <PayoutsBody report={data} />

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${V}.title`)} description={t(`${V}.description`)} />
      <ReportControls
        period={period}
        today={today}
        periodError={error}
        onPeriod={(p) => set({ du: p.from, au: p.to })}
        onExport={
          data && data.rows.length > 0
            ? () => {
                const file = payoutsCsv(data, period)
                downloadCsv(file.fileName, file.content)
              }
            : undefined
        }
      >
        <FilterSelect
          label={t(`${V}.filters.professional`)}
          value={filters.professionalId}
          allLabel={t(`${V}.filters.allProfessionals`)}
          options={(data?.options.professionals ?? []).map((p) => ({ value: p.id, label: p.name }))}
          onChange={(v) => set({ pro: v })}
        />
      </ReportControls>
      {body}
    </div>
  )
}

function PayoutsBody({ report }: { report: PayoutsReport }) {
  const { can } = useAccess()
  const canOpen = can('billing.payroll')
  const x = report.totals
  if (report.rows.length === 0) return <EmptyState title={t(`${V}.empty`)} body={t(`${V}.emptyBody`)} />
  return (
    <div className="space-y-6">
      <Totals
        label={t(`${V}.totals`)}
        items={[
          { label: t(`${V}.totalLabels.periods`), value: String(x.periods) },
          { label: t(`${V}.totalLabels.sessions`), value: String(x.sessions) },
          { label: t(`${V}.totalLabels.total`), value: formatMoney(x.total_cents) },
          { label: t(`${V}.totalLabels.paid`), value: formatMoney(x.paid_cents) },
          { label: t(`${V}.totalLabels.toPay`), value: formatMoney(x.to_pay_cents) },
          { label: t(`${V}.totalLabels.notValidated`), value: String(x.not_validated) },
        ]}
      />
      {report.truncated && (
        <Alert variant="warning">
          <AlertDescription>{t('modules.reports.truncated')}</AlertDescription>
        </Alert>
      )}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t(`${V}.byMonthTitle`)}</h2>
        <Table aria-label={t(`${V}.byMonthTitle`)} scrollLabel={t(`${V}.byMonthTitle`)}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${V}.columns.month`)}</TableHead>
              <TableHead className="text-right">{t(`${V}.columns.professionals`)}</TableHead>
              <TableHead className="text-right max-sm:hidden">{t(`${V}.columns.sessions`)}</TableHead>
              <TableHead className="text-right">{t(`${V}.columns.total`)}</TableHead>
              <TableHead className="text-right max-sm:hidden">{t(`${V}.columns.paid`)}</TableHead>
              <TableHead className="text-right max-md:hidden">{t(`${V}.columns.toPay`)}</TableHead>
              <TableHead className="text-right max-md:hidden">{t(`${V}.columns.notValidated`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.by_month.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="whitespace-nowrap">{monthLabel(m.month.slice(0, 7))}</TableCell>
                <TableCell className="tabular text-right">{m.professionals}</TableCell>
                <TableCell className="tabular text-right max-sm:hidden">{m.sessions}</TableCell>
                <TableCell className="tabular whitespace-nowrap text-right">{formatMoney(m.total_cents)}</TableCell>
                <TableCell className="tabular whitespace-nowrap text-right max-sm:hidden">{formatMoney(m.paid_cents)}</TableCell>
                <TableCell className="tabular whitespace-nowrap text-right max-md:hidden">{formatMoney(m.to_pay_cents)}</TableCell>
                <TableCell className="tabular text-right max-md:hidden">{m.not_validated}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t(`${V}.byProfessionalTitle`)}</h2>
        <Table aria-label={t(`${V}.byProfessionalTitle`)} scrollLabel={t(`${V}.byProfessionalTitle`)}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${V}.columns.professional`)}</TableHead>
              <TableHead className="text-right max-sm:hidden">{t(`${V}.columns.months`)}</TableHead>
              <TableHead className="text-right">{t(`${V}.columns.sessions`)}</TableHead>
              <TableHead className="text-right">{t(`${V}.columns.total`)}</TableHead>
              <TableHead className="text-right max-sm:hidden">{t(`${V}.columns.paid`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.by_professional.map((p) => (
              <TableRow key={p.professional_id}>
                <TableCell>{p.professional_name}</TableCell>
                <TableCell className="tabular text-right max-sm:hidden">{p.months}</TableCell>
                <TableCell className="tabular text-right">{p.sessions}</TableCell>
                <TableCell className="tabular whitespace-nowrap text-right">{formatMoney(p.total_cents)}</TableCell>
                <TableCell className="tabular whitespace-nowrap text-right max-sm:hidden">{formatMoney(p.paid_cents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t(`${V}.rowsTitle`)}</h2>
        <Table aria-label={t(`${V}.rowsTitle`)} scrollLabel={t(`${V}.rowsTitle`)}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${V}.columns.month`)}</TableHead>
              <TableHead>{t(`${V}.columns.professional`)}</TableHead>
              <TableHead className="text-right max-md:hidden">{t(`${V}.columns.sessions`)}</TableHead>
              <TableHead className="text-right max-lg:hidden">{t(`${V}.columns.lateCancellations`)}</TableHead>
              <TableHead className="text-right max-lg:hidden">{t(`${V}.columns.otherAndAdjustments`)}</TableHead>
              <TableHead className="text-right">{t(`${V}.columns.total`)}</TableHead>
              <TableHead>{t(`${V}.columns.state`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((r) => {
              const month = r.month.slice(0, 7)
              return (
                <TableRow key={r.period_id}>
                  <TableCell className="whitespace-nowrap">{monthLabel(month)}</TableCell>
                  <TableCell>
                    {canOpen ? (
                      <Link to={`/facturation/paie?mois=${month}&periode=${r.period_id}`} className="underline-offset-2 hover:underline">
                        {r.professional_name}
                      </Link>
                    ) : (
                      r.professional_name
                    )}
                    {r.title_name && <span className="block text-xs text-muted-foreground">{r.title_name}</span>}
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right max-md:hidden">
                    {r.sessions}
                    <span className="block text-xs text-muted-foreground">{formatMoney(r.session_cents)}</span>
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right max-lg:hidden">
                    {r.late_cancellations}
                    <span className="block text-xs text-muted-foreground">{formatMoney(r.late_cancellation_cents)}</span>
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right max-lg:hidden">{formatMoney(r.other_cents + r.adjustment_cents)}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right">
                    {formatMoney(r.total_cents)}
                    {r.unpriced_count > 0 && (
                      <span className="block text-xs text-warning-strong">{t(`${V}.unpriced`, { count: String(r.unpriced_count) })}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {payoutStateLabel(r.state)}
                    {r.paid_on && <span className="block text-xs text-muted-foreground">{t(`${V}.paidOn`, { date: formatDateOnlyShort(r.paid_on) })}</span>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
