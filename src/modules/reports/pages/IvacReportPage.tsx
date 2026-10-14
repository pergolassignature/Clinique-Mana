import { useMemo } from 'react'
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
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { IVAC_STATES, type IvacReport, type IvacState } from '../api/rp2'
import { FilterSelect, ReportControls, Totals } from '../components/ReportControls'
import { useReportParams } from '../hooks/use-report-params'
import { useIvacReport } from '../hooks/use-reports'
import { formatMoney, periodError } from '../lib/reports'
import { IVAC_SORTS, ivacCsv, ivacServiceLabel, ivacStateLabel, sortIvacRows, type IvacSort } from '../lib/rp2'

const V = 'modules.reports.ivac'

const asState = (value: string | null): IvacState | null => ((IVAC_STATES as readonly string[]).includes(value ?? '') ? (value as IvacState) : null)
const asSort = (value: string | null): IvacSort => ((IVAC_SORTS as readonly string[]).includes(value ?? '') ? (value as IvacSort) : 'date_desc')

/**
 * « IVAC » (`/rapports/ivac`, reports.finance; RP-7, parity audit L5): each session IVAC covers in
 * the period (by its date) and each line billed to IVAC by hand, with what IVAC is billed and where
 * it stands (« À facturer », « En préparation », « Facturée », « Payée en partie », « Payée »);
 * the totals per state; the client's file number with IVAC, the professional's IVAC number, the
 * service, the client's invoice and IVAC's. Filters: the period, the state, the professional; the
 * order (date, client, professional). « Exporter (CSV) » saves what is shown, in its order.
 */
export function IvacReportPage() {
  usePageTitle(t(`${V}.title`))
  const { params, period, today, set } = useReportParams()
  const filters = { from: period.from, to: period.to, state: asState(params.get('etat')), professionalId: params.get('pro') }
  const sort = asSort(params.get('tri'))
  const error = periodError(period)
  const report = useIvacReport(filters, error === null)
  const data = error === null ? report.data : undefined
  const rows = useMemo(() => (data ? sortIvacRows(data.rows, sort) : []), [data, sort])

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
  } else if (data) body = <IvacBody report={data} rows={rows} />

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${V}.title`)} description={t(`${V}.description`)} />
      <ReportControls
        period={period}
        today={today}
        periodError={error}
        onPeriod={(p) => set({ du: p.from, au: p.to })}
        onExport={
          data && rows.length > 0
            ? () => {
                const file = ivacCsv(rows, period)
                downloadCsv(file.fileName, file.content)
              }
            : undefined
        }
      >
        <FilterSelect
          label={t(`${V}.filters.state`)}
          value={filters.state}
          allLabel={t(`${V}.filters.allStates`)}
          options={IVAC_STATES.map((s) => ({ value: s, label: ivacStateLabel(s) }))}
          onChange={(v) => set({ etat: v })}
        />
        <FilterSelect
          label={t(`${V}.filters.professional`)}
          value={filters.professionalId}
          allLabel={t(`${V}.filters.allProfessionals`)}
          options={(data?.options.professionals ?? []).map((p) => ({ value: p.id, label: p.name }))}
          onChange={(v) => set({ pro: v })}
        />
        <FormField label={t(`${V}.sort.label`)} width="md">
          {(field) => (
            <Select {...field} value={sort} onChange={(e) => set({ tri: e.target.value === 'date_desc' ? null : e.target.value })}>
              {IVAC_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`${V}.sort.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </ReportControls>
      {body}
    </div>
  )
}

function IvacBody({ report, rows }: { report: IvacReport; rows: ReturnType<typeof sortIvacRows> }) {
  const { can } = useAccess()
  const canOpenInvoices = can('billing.view')
  const invoice = (id: string | null, number: string | null) => {
    if (!number) return null
    if (!id || !canOpenInvoices) return number
    return (
      <Link to={`/facturation/factures/${id}`} className="underline-offset-2 hover:underline">
        {number}
      </Link>
    )
  }
  const s = report.by_state
  return (
    <div className="space-y-4">
      <Totals
        label={t(`${V}.totals`)}
        items={[
          { label: t(`${V}.totalLabels.all`, { count: String(report.totals.count) }), value: formatMoney(report.totals.amount_cents) },
          ...(['to_claim', 'draft', 'claimed', 'partial', 'paid'] as const).map((state) => ({
            label: t(`${V}.totalLabels.state`, { state: ivacStateLabel(state), count: String(s[state].count) }),
            value: formatMoney(s[state].amount_cents),
          })),
        ]}
      />
      {report.truncated && (
        <Alert variant="warning">
          <AlertDescription>{t('modules.reports.truncated')}</AlertDescription>
        </Alert>
      )}
      {rows.length === 0 ? (
        <EmptyState title={t(`${V}.empty`)} />
      ) : (
        <Table aria-label={t(`${V}.table`)} scrollLabel={t(`${V}.table`)}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${V}.columns.date`)}</TableHead>
              <TableHead>{t(`${V}.columns.client`)}</TableHead>
              <TableHead className="max-md:hidden">{t(`${V}.columns.professional`)}</TableHead>
              <TableHead className="max-lg:hidden">{t(`${V}.columns.service`)}</TableHead>
              <TableHead className="text-right">{t(`${V}.columns.amount`)}</TableHead>
              <TableHead>{t(`${V}.columns.state`)}</TableHead>
              <TableHead className="max-sm:hidden">{t(`${V}.columns.invoices`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.line_id}>
                <TableCell className="tabular whitespace-nowrap">{formatDateOnlyShort(r.service_on)}</TableCell>
                <TableCell>
                  {r.client_name}
                  <span className="block text-xs text-muted-foreground">
                    {r.file_number ? t(`${V}.ivacFile`, { number: r.file_number }) : t(`${V}.noIvacFile`)}
                  </span>
                </TableCell>
                <TableCell className="max-md:hidden">
                  {r.professional_name}
                  {r.professional_name && (
                    <span className="block text-xs text-muted-foreground">
                      {r.professional_ivac_number ? t(`${V}.ivacNumber`, { number: r.professional_ivac_number }) : t(`${V}.noIvacNumber`)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="max-lg:hidden">
                  {ivacServiceLabel(r)}
                  {r.by_hand && <span className="block text-xs text-muted-foreground">{t(`${V}.byHand`)}</span>}
                </TableCell>
                <TableCell className="tabular whitespace-nowrap text-right">{formatMoney(r.amount_cents)}</TableCell>
                <TableCell className="whitespace-nowrap">{ivacStateLabel(r.state)}</TableCell>
                <TableCell className="tabular max-sm:hidden">
                  {r.client_invoice_number && (
                    <span className="block whitespace-nowrap">
                      {t(`${V}.clientInvoice`)} {invoice(r.client_invoice_id, r.client_invoice_number)}
                    </span>
                  )}
                  {(r.payer_invoice_number || r.state === 'draft') && (
                    <span className="block whitespace-nowrap">
                      {t(`${V}.ivacInvoice`)} {invoice(r.payer_invoice_id, r.payer_invoice_number ?? t(`${V}.draftInvoice`))}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
