import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { downloadCsv } from '@/shared/lib/csv'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { ConsentsReport } from '../api/reports'
import { FilterSelect, ReportControls, Totals } from '../components/ReportControls'
import { useReportParams } from '../hooks/use-report-params'
import { useConsentsReport } from '../hooks/use-reports'
import { consentsCsv, daysLabel, monthLabel, periodError, type Period } from '../lib/reports'

const C = 'modules.reports.consents'
const COL = `${C}.columns`

/**
 * « Consentements » (`/rapports/consentements`, reports.view; Clients C5b, CC-19): today's
 * states of the active files per consent (the record tabs' words and counts) and per primary
 * professional; for the period, the signatures (in the app, imported) and the withdrawals per
 * month, and the send → sign delay per consent. Filters: the period, the primary professional.
 * Counts only, never a name. « Exporter (CSV) » saves the states per consent.
 */
export function ConsentsReportPage() {
  usePageTitle(t(`${C}.title`))
  const { params, period, today, set } = useReportParams()
  const error = periodError(period)
  const professionalId = params.get('pro')
  const report = useConsentsReport({ from: period.from, to: period.to, professionalId }, error === null)
  const data = error === null ? report.data : undefined

  let body
  if (error) body = null
  else if (report.isPending) body = <Loading />
  else if (report.isError && !report.data) {
    body = <LoadError message={moduleErrorMessage(report.error, t(`${C}.loadError`), 'reports')} retrying={report.isFetching} onRetry={() => void report.refetch()} />
  } else if (report.data) body = <ConsentsBody report={report.data} />

  const onExport = () => {
    if (!report.data) return
    const file = consentsCsv(report.data, period)
    downloadCsv(file.fileName, file.content)
  }

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${C}.title`)} description={t(`${C}.description`)} />
      <ReportControls
        period={period}
        today={today}
        periodError={error}
        onPeriod={(p: Period) => set({ du: p.from, au: p.to })}
        onExport={data && data.gaps.length > 0 ? onExport : undefined}
      >
        <FilterSelect
          label={t(`${C}.filters.professional`)}
          value={professionalId}
          allLabel={t(`${C}.filters.allProfessionals`)}
          options={(report.data?.options.professionals ?? []).map((p) => ({ value: p.id, label: p.name }))}
          onChange={(v) => set({ pro: v })}
        />
      </ReportControls>
      {body}
    </div>
  )
}

function ConsentsBody({ report }: { report: ConsentsReport }) {
  return (
    <div className="space-y-6">
      <Totals
        label={t(`${C}.totals`)}
        items={[
          { label: t(`${C}.totalLabels.clients`), value: String(report.totals.clients) },
          { label: t(`${C}.totalLabels.signed`), value: String(report.totals.signed) },
          { label: t(`${C}.totalLabels.withdrawn`), value: String(report.totals.withdrawn) },
        ]}
      />
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t(`${C}.gapsTitle`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`${C}.gapsHelp`)}</p>
        {report.gaps.length === 0 ? (
          <EmptyState title={t(`${C}.empty`)} />
        ) : (
          <Table aria-label={t(`${C}.gapsTitle`)} scrollLabel={t(`${C}.gapsTitle`)}>
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${COL}.consent`)}</TableHead>
                {(['signed', 'resign', 'pending', 'overdue', 'withdrawn', 'none'] as const).map((k) => (
                  <TableHead key={k} className="text-right">
                    {t(`${COL}.${k}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.gaps.map((g) => (
                <TableRow key={g.consent_key}>
                  <TableCell>{g.consent_name}</TableCell>
                  <TableCell className="tabular text-right">{g.signed}</TableCell>
                  <TableCell className="tabular text-right">{g.resign}</TableCell>
                  <TableCell className="tabular text-right">{g.pending}</TableCell>
                  <TableCell className="tabular text-right">{g.overdue}</TableCell>
                  <TableCell className="tabular text-right">{g.withdrawn}</TableCell>
                  <TableCell className="tabular text-right">{g.none}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {report.by_professional.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">{t(`${C}.byProfessionalTitle`)}</h2>
          <p className="text-sm text-muted-foreground">{t(`${C}.byProfessionalHelp`)}</p>
          <Table aria-label={t(`${C}.byProfessionalTitle`)} scrollLabel={t(`${C}.byProfessionalTitle`)}>
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${COL}.professional`)}</TableHead>
                <TableHead>{t(`${COL}.consent`)}</TableHead>
                <TableHead className="text-right">{t(`${COL}.signed`)}</TableHead>
                <TableHead className="text-right">{t(`${COL}.toObtain`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_professional.map((b) => (
                <TableRow key={`${b.professional_id ?? '-'}:${b.consent_key}`}>
                  <TableCell>{b.professional_name ?? t(`${C}.noProfessional`)}</TableCell>
                  <TableCell>{b.consent_name}</TableCell>
                  <TableCell className="tabular text-right">{b.signed}</TableCell>
                  <TableCell className="tabular text-right">{b.to_obtain}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t(`${C}.monthsTitle`)}</h2>
        <Table aria-label={t(`${C}.monthsTitle`)} scrollLabel={t(`${C}.monthsTitle`)}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${COL}.month`)}</TableHead>
              <TableHead className="text-right">{t(`${COL}.signedApp`)}</TableHead>
              <TableHead className="text-right">{t(`${COL}.imported`)}</TableHead>
              <TableHead className="text-right">{t(`${COL}.withdrawn`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{monthLabel(m.month)}</TableCell>
                <TableCell className="tabular text-right">{m.signed}</TableCell>
                <TableCell className="tabular text-right">{m.imported}</TableCell>
                <TableCell className="tabular text-right">{m.withdrawn}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t(`${C}.delaysTitle`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`${C}.delaysHelp`)}</p>
        {report.delays.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${C}.delaysEmpty`)}</p>
        ) : (
          <Table aria-label={t(`${C}.delaysTitle`)} scrollLabel={t(`${C}.delaysTitle`)}>
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${COL}.consent`)}</TableHead>
                <TableHead className="text-right">{t(`${COL}.count`)}</TableHead>
                <TableHead className="text-right">{t(`${COL}.average`)}</TableHead>
                <TableHead className="text-right">{t(`${COL}.median`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.delays.map((d) => (
                <TableRow key={d.consent_key}>
                  <TableCell>{d.consent_name}</TableCell>
                  <TableCell className="tabular text-right">{d.count}</TableCell>
                  <TableCell className="tabular text-right">{daysLabel(d.average_days)}</TableCell>
                  <TableCell className="tabular text-right">{daysLabel(d.median_days)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}
