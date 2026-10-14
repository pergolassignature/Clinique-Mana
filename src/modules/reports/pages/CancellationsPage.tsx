import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { downloadCsv } from '@/shared/lib/csv'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { ABSENCE_KINDS, type AbsenceKind, type CancellationsReport, type FollowUpReport } from '../api/reports'
import { FilterSelect, ReportControls, Totals } from '../components/ReportControls'
import { useReportParams } from '../hooks/use-report-params'
import { useCancellations, useFollowUp } from '../hooks/use-reports'
import { cancellationsCsv, followUpCsv, kindLabel, periodError, reasonLabel, type Period } from '../lib/reports'

const C = 'modules.reports.cancellations'
const F = 'modules.reports.followUp'
const TABS = ['reasons', 'follow-up'] as const
type Tab = (typeof TABS)[number]

/**
 * « Annulations et absences » (`/rapports/annulations`, reports.view): the cancellations of the
 * period by reason (late or not) and the absences (RP-3); « Clients à relancer »
 * (`?onglet=relancer`): per client, the last cancellation or absence with nothing booked after it,
 * to call back (RP-4). Filters: the period, the professional; the type and the reason for the
 * first view. « Exporter (CSV) » saves what is shown (RP-6).
 */
export function CancellationsPage() {
  usePageTitle(t(`${C}.title`))
  const { params, period, today, set } = useReportParams()
  const tab: Tab = params.get('onglet') === 'relancer' ? 'follow-up' : 'reasons'
  const error = periodError(period)
  const professionalId = params.get('pro')
  const kindParam = params.get('type')
  const kind = (ABSENCE_KINDS as readonly string[]).includes(kindParam ?? '') ? (kindParam as AbsenceKind) : null
  const cancellations = useCancellations(
    { from: period.from, to: period.to, professionalId, reasonId: params.get('raison'), kind },
    error === null && tab === 'reasons',
  )
  const followUp = useFollowUp({ from: period.from, to: period.to, professionalId }, error === null && tab === 'follow-up')
  const query = tab === 'reasons' ? cancellations : followUp
  const data = error === null ? query.data : undefined

  let body: ReactNode
  if (error) body = null
  else if (query.isPending) body = <Loading />
  else if (query.isError && !query.data) {
    body = (
      <LoadError
        message={moduleErrorMessage(query.error, t(`${C}.loadError`), 'reports')}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (tab === 'reasons' && cancellations.data) body = <ReasonsBody report={cancellations.data} />
  else if (tab === 'follow-up' && followUp.data) body = <FollowUpBody report={followUp.data} />

  const onExport = () => {
    const file = tab === 'reasons' && cancellations.data
      ? cancellationsCsv(cancellations.data, period)
      : followUp.data ? followUpCsv(followUp.data, period) : null
    if (file) downloadCsv(file.fileName, file.content)
  }
  const professionals = (tab === 'reasons' ? cancellations.data : followUp.data)?.options.professionals ?? []

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${C}.title`)} description={t(`${C}.description`)} />
      <Tabs value={tab} onValueChange={(v) => set({ onglet: v === 'follow-up' ? 'relancer' : null, type: null, raison: null })} className="space-y-5">
        <TabsList aria-label={t(`${C}.views`)}>
          {TABS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`${C}.tabs.${v === 'reasons' ? 'reasons' : 'followUp'}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((v) => (
          <TabsContent key={v} value={v} className="space-y-5">
            <ReportControls
              period={period}
              today={today}
              periodError={error}
              onPeriod={(p: Period) => set({ du: p.from, au: p.to })}
              onExport={data && data.rows.length > 0 ? onExport : undefined}
            >
              <FilterSelect
                label={t(`${C}.filters.professional`)}
                value={professionalId}
                allLabel={t(`${C}.filters.allProfessionals`)}
                options={professionals.map((p) => ({ value: p.id, label: p.name }))}
                onChange={(v) => set({ pro: v })}
              />
              {tab === 'reasons' && (
                <>
                  <FilterSelect
                    label={t(`${C}.filters.kind`)}
                    value={kind}
                    allLabel={t(`${C}.filters.allKinds`)}
                    options={ABSENCE_KINDS.map((k) => ({ value: k, label: t(`${C}.filters.kinds.${k}`) }))}
                    onChange={(v) => set({ type: v, raison: v === 'absent' ? null : params.get('raison') })}
                  />
                  {kind !== 'absent' && (
                    <FilterSelect
                      label={t(`${C}.filters.reason`)}
                      value={params.get('raison')}
                      allLabel={t(`${C}.filters.allReasons`)}
                      options={(cancellations.data?.options.reasons ?? []).map((r) => ({ value: r.id, label: r.name }))}
                      onChange={(v) => set({ raison: v })}
                    />
                  )}
                </>
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

const clientLink = (id: string, name: string | null) => (
  <Link to={`/clients/${id}`} className="underline-offset-2 hover:underline">
    {name ?? t(`${C}.unnamed`)}
  </Link>
)

function ReasonsBody({ report }: { report: CancellationsReport }) {
  const x = report.totals
  return (
    <div className="space-y-4">
      <Totals
        label={t(`${C}.totals`)}
        items={[
          { label: t(`${C}.totalLabels.cancelled`), value: String(x.cancelled) },
          { label: t(`${C}.totalLabels.late`), value: String(x.late) },
          { label: t(`${C}.totalLabels.absent`), value: String(x.absent) },
        ]}
      />
      <Truncated show={report.truncated} />
      {report.rows.length === 0 ? (
        <EmptyState title={t(`${C}.empty`)} />
      ) : (
        <>
          <Table aria-label={t(`${C}.byReason`)} scrollLabel={t(`${C}.byReason`)}>
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${C}.columns.reason`)}</TableHead>
                <TableHead className="text-right">{t(`${C}.columns.count`)}</TableHead>
                <TableHead className="text-right">{t(`${C}.columns.late`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_reason.map((g) => (
                <TableRow key={`${g.kind}:${g.reason_id ?? ''}`}>
                  <TableCell>{reasonLabel(g)}</TableCell>
                  <TableCell className="tabular text-right">{g.count}</TableCell>
                  <TableCell className="tabular text-right">{g.kind === 'absent' ? '' : g.late}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table aria-label={t(`${C}.list`)} scrollLabel={t(`${C}.list`)}>
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${C}.columns.date`)}</TableHead>
                <TableHead>{t(`${C}.columns.client`)}</TableHead>
                <TableHead className="max-md:hidden">{t(`${C}.columns.professional`)}</TableHead>
                <TableHead>{t(`${C}.columns.kind`)}</TableHead>
                <TableHead className="max-sm:hidden">{t(`${C}.columns.next`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={`${r.appointment_id}:${r.client_id}`}>
                  <TableCell className="tabular whitespace-nowrap">{formatClinicDateTime(r.starts_at)}</TableCell>
                  <TableCell>{clientLink(r.client_id, r.client_name)}</TableCell>
                  <TableCell className="max-md:hidden">{r.professional_name}</TableCell>
                  <TableCell>
                    {kindLabel(r)}
                    {r.kind === 'cancelled' && <span className="block text-xs text-muted-foreground">{reasonLabel(r)}</span>}
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap max-sm:hidden">
                    {r.later_starts_at ? formatClinicDateTime(r.later_starts_at) : t(`${C}.nothingAfter`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}

function FollowUpBody({ report }: { report: FollowUpReport }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(`${F}.count`, { count: String(report.total) })}</p>
      <Truncated show={report.truncated} />
      {report.rows.length === 0 ? (
        <EmptyState title={t(`${F}.empty`)} />
      ) : (
        <Table aria-label={t(`${F}.title`)} scrollLabel={t(`${F}.title`)}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${F}.columns.client`)}</TableHead>
              <TableHead>{t(`${F}.columns.date`)}</TableHead>
              <TableHead>{t(`${F}.columns.kind`)}</TableHead>
              <TableHead className="max-md:hidden">{t(`${F}.columns.professional`)}</TableHead>
              <TableHead className="text-right max-sm:hidden">{t(`${F}.columns.events`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((r) => (
              <TableRow key={r.client_id}>
                <TableCell>{clientLink(r.client_id, r.client_name)}</TableCell>
                <TableCell className="tabular whitespace-nowrap">{formatClinicDateTime(r.starts_at)}</TableCell>
                <TableCell>
                  {kindLabel(r)}
                  {r.kind === 'cancelled' && <span className="block text-xs text-muted-foreground">{reasonLabel(r)}</span>}
                </TableCell>
                <TableCell className="max-md:hidden">{r.professional_name}</TableCell>
                <TableCell className="tabular text-right max-sm:hidden">{r.events}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
