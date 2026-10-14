import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { downloadCsv } from '@/shared/lib/csv'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { REVENUE_VIEWS, type RevenueReport, type RevenueView } from '../api/reports'
import { FilterSelect, ReportControls, Totals } from '../components/ReportControls'
import { useReportParams } from '../hooks/use-report-params'
import { useRevenue } from '../hooks/use-reports'
import { formatMoney, formatQuantity, lineTypeLabel, periodError, revenueCsv, serviceLabel } from '../lib/reports'

const V = 'modules.reports.revenue'

const asView = (value: string | null): RevenueView =>
  (REVENUE_VIEWS as readonly string[]).includes(value ?? '') ? (value as RevenueView) : 'invoice'

/**
 * « Revenus » (`/rapports/revenus`, reports.finance; RP-2), like GOrendezvous's: by invoice (the
 * invoices issued in the period and not credited), by service (their lines, and the total per
 * service), by payment (the payments made in the period and the refunds recorded in it, L6; the
 * received, refunded and net per mode). Filters: the
 * period, the professional, the service, the payment mode (by payment). « Exporter (CSV) » saves
 * what is shown (RP-6).
 */
export function RevenuePage() {
  usePageTitle(t(`${V}.title`))
  const { params, period, today, set } = useReportParams()
  const view = asView(params.get('vue'))
  const filters = {
    view,
    from: period.from,
    to: period.to,
    professionalId: params.get('pro'),
    serviceId: params.get('service'),
    modeCode: view === 'payment' ? params.get('mode') : null,
  }
  const error = periodError(period)
  const report = useRevenue(filters, error === null)
  const data = error === null ? report.data : undefined
  const options = data?.options

  let body: ReactNode
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
  } else if (data) body = <RevenueBody report={data} />

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${V}.title`)} description={t(`${V}.description`)} />
      <Tabs value={view} onValueChange={(v) => set({ vue: v === 'invoice' ? null : v, mode: null })} className="space-y-5">
        <TabsList aria-label={t(`${V}.views`)}>
          {REVENUE_VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`${V}.viewLabels.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {REVENUE_VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="space-y-5">
            <ReportControls
              period={period}
              today={today}
              periodError={error}
              onPeriod={(p) => set({ du: p.from, au: p.to })}
              onExport={data && data.rows.length > 0 ? () => {
                const file = revenueCsv(data, period)
                downloadCsv(file.fileName, file.content)
              } : undefined}
            >
              <FilterSelect
                label={t(`${V}.filters.professional`)}
                value={filters.professionalId}
                allLabel={t(`${V}.filters.allProfessionals`)}
                options={(options?.professionals ?? []).map((p) => ({ value: p.id, label: p.name }))}
                onChange={(v) => set({ pro: v })}
              />
              <FilterSelect
                label={t(`${V}.filters.service`)}
                value={filters.serviceId}
                allLabel={t(`${V}.filters.allServices`)}
                options={(options?.services ?? []).map((s) => ({ value: s.id, label: s.code ? `${s.code} · ${s.name}` : s.name }))}
                onChange={(v) => set({ service: v })}
              />
              {view === 'payment' && (
                <FilterSelect
                  label={t(`${V}.filters.mode`)}
                  value={filters.modeCode}
                  allLabel={t(`${V}.filters.allModes`)}
                  options={(options?.modes ?? []).map((m) => ({ value: m.code, label: m.name }))}
                  onChange={(v) => set({ mode: v })}
                />
              )}
            </ReportControls>
            {body}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function Truncated({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <Alert variant="warning">
      <AlertDescription>{t('modules.reports.truncated')}</AlertDescription>
    </Alert>
  )
}

const invoiceLink = (id: string, number: string) => (
  <Link to={`/facturation/factures/${id}`} className="underline-offset-2 hover:underline">
    {number}
  </Link>
)

function RevenueBody({ report }: { report: RevenueReport }) {
  if (report.view === 'invoice') {
    const x = report.totals
    return (
      <div className="space-y-4">
        <Totals
          label={t(`${V}.totals`)}
          items={[
            { label: t(`${V}.totalLabels.invoices`), value: String(x.count) },
            { label: t(`${V}.totalLabels.subtotal`), value: formatMoney(x.subtotal_cents) },
            { label: t(`${V}.totalLabels.taxes`), value: formatMoney(x.gst_cents + x.qst_cents) },
            { label: t(`${V}.totalLabels.total`), value: formatMoney(x.total_cents) },
            { label: t(`${V}.totalLabels.paid`), value: formatMoney(x.paid_cents) },
            { label: t(`${V}.totalLabels.balance`), value: formatMoney(x.balance_cents) },
          ]}
        />
        {report.credited.count > 0 && (
          <p className="text-sm text-muted-foreground">
            {t(`${V}.credited`, { count: String(report.credited.count), amount: formatMoney(report.credited.total_cents) })}
          </p>
        )}
        <Truncated show={report.truncated} />
        {report.rows.length === 0 ? (
          <EmptyState title={t(`${V}.empty`)} />
        ) : (
          <Table aria-label={t(`${V}.viewLabels.invoice`)} scrollLabel={t(`${V}.viewLabels.invoice`)}>
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead className="max-sm:hidden">{t(`${V}.columns.date`)}</TableHead>
                <TableHead>{t(`${V}.columns.number`)}</TableHead>
                <TableHead>{t(`${V}.columns.client`)}</TableHead>
                <TableHead className="max-md:hidden">{t(`${V}.columns.professional`)}</TableHead>
                <TableHead className="text-right">{t(`${V}.columns.total`)}</TableHead>
                <TableHead className="text-right max-sm:hidden">{t(`${V}.columns.paid`)}</TableHead>
                <TableHead className="text-right">{t(`${V}.columns.balance`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.invoice_id}>
                  <TableCell className="tabular whitespace-nowrap max-sm:hidden">{formatDateOnlyShort(r.issued_on)}</TableCell>
                  <TableCell className="tabular whitespace-nowrap">
                    {invoiceLink(r.invoice_id, r.number)}
                    {/* On a phone the date goes under the number (the table fits). */}
                    <span className="block text-xs text-muted-foreground sm:hidden">{formatDateOnlyShort(r.issued_on)}</span>
                  </TableCell>
                  <TableCell>
                    {r.client_name}
                    {r.payer_name && <span className="block text-xs text-muted-foreground">{t(`${V}.billedTo`, { name: r.payer_name })}</span>}
                  </TableCell>
                  <TableCell className="max-md:hidden">{r.professional_names}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right">{formatMoney(r.total_cents)}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right max-sm:hidden">{formatMoney(r.paid_cents)}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right">{formatMoney(r.balance_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    )
  }

  if (report.view === 'service') {
    const x = report.totals
    return (
      <div className="space-y-4">
        <Totals
          label={t(`${V}.totals`)}
          items={[
            { label: t(`${V}.totalLabels.lines`), value: String(x.count) },
            { label: t(`${V}.totalLabels.quantity`), value: formatQuantity(x.quantity) },
            { label: t(`${V}.totalLabels.subtotal`), value: formatMoney(x.subtotal_cents) },
            { label: t(`${V}.totalLabels.taxes`), value: formatMoney(x.gst_cents + x.qst_cents) },
            { label: t(`${V}.totalLabels.total`), value: formatMoney(x.total_cents) },
          ]}
        />
        {report.credited.count > 0 && (
          <p className="text-sm text-muted-foreground">
            {t(`${V}.credited`, { count: String(report.credited.count), amount: formatMoney(report.credited.total_cents) })}
          </p>
        )}
        <Truncated show={report.truncated} />
        {report.rows.length === 0 ? (
          <EmptyState title={t(`${V}.empty`)} />
        ) : (
          <>
            <Table aria-label={t(`${V}.byService`)} scrollLabel={t(`${V}.byService`)}>
              <TableHeader>
                <TableRow className="[&>th]:whitespace-nowrap">
                  <TableHead>{t(`${V}.columns.service`)}</TableHead>
                  <TableHead className="text-right">{t(`${V}.columns.quantity`)}</TableHead>
                  <TableHead className="text-right">{t(`${V}.columns.total`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.by_service.map((g) => (
                  <TableRow key={g.service_id ?? g.line_type ?? ''}>
                    <TableCell>{serviceLabel(g)}</TableCell>
                    <TableCell className="tabular text-right">{formatQuantity(g.quantity)}</TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right">{formatMoney(g.total_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Table aria-label={t(`${V}.lines`)} scrollLabel={t(`${V}.lines`)}>
              <TableHeader>
                <TableRow className="[&>th]:whitespace-nowrap">
                  <TableHead className="max-sm:hidden">{t(`${V}.columns.date`)}</TableHead>
                  <TableHead>{t(`${V}.columns.number`)}</TableHead>
                  <TableHead>{t(`${V}.columns.client`)}</TableHead>
                  <TableHead className="max-md:hidden">{t(`${V}.columns.professional`)}</TableHead>
                  <TableHead>{t(`${V}.columns.service`)}</TableHead>
                  <TableHead className="text-right">{t(`${V}.columns.total`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.line_id}>
                    <TableCell className="tabular whitespace-nowrap max-sm:hidden">{formatDateOnlyShort(r.issued_on)}</TableCell>
                    <TableCell className="tabular whitespace-nowrap">
                      {invoiceLink(r.invoice_id, r.number)}
                      {/* On a phone the date goes under the number (the table fits). */}
                      <span className="block text-xs text-muted-foreground sm:hidden">{formatDateOnlyShort(r.issued_on)}</span>
                    </TableCell>
                    <TableCell>{r.client_name}</TableCell>
                    <TableCell className="max-md:hidden">{r.professional_name}</TableCell>
                    <TableCell>
                      {r.service_name ? serviceLabel(r) : `${lineTypeLabel(r.line_type)} · ${r.description}`}
                      {r.quantity !== 1 && <span className="text-muted-foreground"> × {formatQuantity(r.quantity)}</span>}
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right">{formatMoney(r.total_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </div>
    )
  }

  const x = report.totals
  return (
    <div className="space-y-4">
      <Totals
        label={t(`${V}.totals`)}
        items={[
          { label: t(`${V}.totalLabels.payments`), value: String(x.count) },
          { label: t(`${V}.totalLabels.received`), value: formatMoney(x.amount_cents) },
          ...(x.refunds_count > 0
            ? [
                { label: t(`${V}.totalLabels.refunds`, { count: String(x.refunds_count) }), value: formatMoney(-x.refunds_cents) },
                { label: t(`${V}.totalLabels.net`), value: formatMoney(x.net_cents ?? x.amount_cents - x.refunds_cents) },
              ]
            : []),
          ...report.by_mode.map((m) => ({ label: m.mode_name, value: formatMoney(m.net_cents ?? m.amount_cents - m.refunds_cents) })),
        ]}
      />
      <Truncated show={report.truncated} />
      {report.rows.length === 0 ? (
        <EmptyState title={t(`${V}.emptyPayments`)} />
      ) : (
        <Table aria-label={t(`${V}.viewLabels.payment`)} scrollLabel={t(`${V}.viewLabels.payment`)}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead className="max-sm:hidden">{t(`${V}.columns.date`)}</TableHead>
              <TableHead>{t(`${V}.columns.number`)}</TableHead>
              <TableHead>{t(`${V}.columns.client`)}</TableHead>
              <TableHead>{t(`${V}.columns.mode`)}</TableHead>
              <TableHead className="max-md:hidden">{t(`${V}.columns.reference`)}</TableHead>
              <TableHead className="text-right">{t(`${V}.columns.amount`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((r) => (
              <TableRow key={r.row_id ?? r.payment_id}>
                <TableCell className="tabular whitespace-nowrap max-sm:hidden">{formatDateOnlyShort(r.paid_on)}</TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  {invoiceLink(r.invoice_id, r.number)}
                  {/* On a phone the date goes under the number (the table fits). */}
                  <span className="block text-xs text-muted-foreground sm:hidden">{formatDateOnlyShort(r.paid_on)}</span>
                </TableCell>
                <TableCell>
                  {r.client_name}
                  {r.payer_name && <span className="block text-xs text-muted-foreground">{t(`${V}.paidBy`, { name: r.payer_name })}</span>}
                </TableCell>
                <TableCell>
                  {r.mode_name}
                  {r.kind === 'refund' && <span className="block text-xs text-muted-foreground">{t(`${V}.refund`)}</span>}
                </TableCell>
                <TableCell className="max-md:hidden">{r.reference}</TableCell>
                <TableCell className="tabular whitespace-nowrap text-right">{formatMoney(r.amount_cents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
