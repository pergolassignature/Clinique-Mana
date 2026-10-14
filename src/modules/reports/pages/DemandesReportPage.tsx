import { useId, type ReactNode } from 'react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { downloadCsv } from '@/shared/lib/csv'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import type { DemandesReport } from '../api/demandes-report'
import { ReportControls, Totals } from '../components/ReportControls'
import { useReportParams } from '../hooks/use-report-params'
import { useDemandesReport } from '../hooks/use-reports'
import {
  DEMANDES_TABS,
  campaignLabel,
  channelLabel,
  clienteleLabel,
  counselorLabel,
  demandesCsv,
  exitReasonLabel,
  formatBusinessDays,
  formatDays,
  formatHours,
  formatRate,
  listLabel,
  monthLabel,
  outcomeLabel,
  professionalLabel,
  reasonLabel,
  referrerLabel,
  sourceLabel,
  utmLabel,
  weekLabel,
  type DemandesTab,
} from '../lib/demandes-report'
import { periodError, type Period } from '../lib/reports'

const D = 'modules.reports.demandes'
const C = `${D}.columns`
/** The tab's French URL value (`?onglet=`); the first tab has none. */
const TAB_PARAMS: Record<DemandesTab, string | null> = { activity: null, sources: 'provenance', delays: 'delais', waitlist: 'liste-attente' }

/**
 * Rapports « Indicateurs des demandes » (`/rapports/demandes`, reports.demandes_indicators or reports.view (R-81), Demandes enabled;
 * Demandes D6): the intake indicators of the counselors' workbook (§8.3) on a period. Real tabs
 * (`?onglet=`): « Activité » (received, the two match rates, the promise of 2 business days, per
 * week and month, channel, conseillère, outcome, professional, clientèle), « Provenance » (D3c's
 * capture), « Délais et premiers rendez-vous », « Liste d'attente et places » (D5's photos).
 * « Exporter (CSV) » saves the tab shown (RP-6).
 */
export function DemandesReportPage() {
  usePageTitle(t(`${D}.title`))
  const { params, period, today, set } = useReportParams()
  const tab: DemandesTab = DEMANDES_TABS.find((x) => TAB_PARAMS[x] === params.get('onglet')) ?? 'activity'
  const error = periodError(period)
  const query = useDemandesReport({ from: period.from, to: period.to }, error === null)
  const report = error === null ? query.data : undefined

  let body: ReactNode = null
  if (error) body = null
  else if (query.isPending) body = <Loading />
  else if (query.isError && !query.data) {
    body = (
      <LoadError message={moduleErrorMessage(query.error, t(`${D}.loadError`), 'reports')} retrying={query.isFetching} onRetry={() => void query.refetch()} />
    )
  } else if (report) {
    const p = { from: report.from, to: report.to }
    body =
      tab === 'activity' ? <Activity report={report} period={p} />
      : tab === 'sources' ? <Sources report={report} />
      : tab === 'delays' ? <Delays report={report} period={p} />
      : <Waitlist report={report} period={p} />
  }

  const onExport = () => {
    if (!report) return
    const file = demandesCsv(report, tab, period)
    downloadCsv(file.fileName, file.content)
  }

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${D}.title`)} description={t(`${D}.description`)} />
      <Tabs value={tab} onValueChange={(v) => set({ onglet: TAB_PARAMS[v as DemandesTab] })} className="space-y-5">
        <TabsList aria-label={t(`${D}.views`)}>
          {DEMANDES_TABS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`${D}.tabs.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {DEMANDES_TABS.map((v) => (
          <TabsContent key={v} value={v} className="space-y-5">
            <ReportControls period={period} today={today} periodError={error} onPeriod={(next: Period) => set({ du: next.from, au: next.to })} onExport={report ? onExport : undefined} />
            {body}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

interface Column {
  label: string
  numeric?: boolean
}

/** A small table under its heading (the table is named by it); an empty one says so. */
function Section({ title, columns, rows, empty }: { title: string; columns: readonly Column[]; rows: readonly (readonly ReactNode[])[]; empty?: string }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="text-sm font-semibold text-foreground">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty ?? t(`${D}.emptySection`)}</p>
      ) : (
        <Table aria-labelledby={headingId} scrollLabel={title}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              {columns.map((c) => (
                <TableHead key={c.label} className={c.numeric ? 'text-right' : undefined}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => (
                  <TableCell key={j} className={columns[j]?.numeric ? 'tabular text-right' : undefined}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

const received = (): Column => ({ label: t(`${C}.received`), numeric: true })
const matchedSince = (): Column => ({ label: t(`${C}.matchedSince`), numeric: true })
const matches = (): Column => ({ label: t(`${C}.matches`), numeric: true })
const count = (): Column => ({ label: t(`${C}.count`), numeric: true })

interface Bounds {
  from: string
  to: string
}

function Activity({ report, period }: { report: DemandesReport; period: Bounds }) {
  const x = report.totals
  if (x.received === 0 && x.matched_activity === 0 && x.duplicates === 0) return <EmptyState title={t(`${D}.empty`)} />
  return (
    <div className="space-y-5">
      <Totals
        label={t(`${D}.sections.totals`)}
        items={[
          { label: t(`${D}.totals.received`), value: String(x.received) },
          { label: t(`${D}.totals.matchedActivity`), value: t(`${D}.totals.withRate`, { count: String(x.matched_activity), rate: formatRate(x.activity_rate) }) },
          { label: t(`${D}.totals.matchedCohort`), value: t(`${D}.totals.withRate`, { count: String(x.matched_cohort), rate: formatRate(x.cohort_rate) }) },
          { label: t(`${D}.totals.waitlisted`), value: String(x.waitlisted) },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        {t(`${D}.rateHelp`)} {x.duplicates > 0 && t(`${D}.totals.duplicatesLine`, { count: String(x.duplicates) })}
      </p>
      <Section
        title={t(`${D}.sections.promise`)}
        columns={[{ label: t(`${C}.promise`) }, { label: t(`${C}.requests`), numeric: true }]}
        rows={[
          [t(`${D}.totals.contactedOnTime`), x.contacted_on_time],
          [t(`${D}.totals.contactedLate`), x.contacted_late],
          [t(`${D}.totals.pending`), x.pending],
          [t(`${D}.totals.overdue`), x.overdue],
          [t(`${D}.totals.noAttempt`), x.no_attempt],
        ]}
      />
      <Section
        title={t(`${D}.sections.weeks`)}
        columns={[{ label: t(`${C}.week`) }, received(), matches()]}
        rows={report.weeks.map((w) => [weekLabel(w.week_start, period), w.received, w.matched])}
      />
      <Section
        title={t(`${D}.sections.months`)}
        columns={[{ label: t(`${C}.month`) }, received(), matches()]}
        rows={report.months.map((m) => [monthLabel(m.month_start, period), m.received, m.matched])}
      />
      <Section title={t(`${D}.sections.channels`)} columns={[{ label: t(`${C}.channel`) }, received(), matchedSince()]} rows={report.by_channel.map((r) => [channelLabel(r.channel), r.received, r.matched])} />
      <Section title={t(`${D}.sections.counselors`)} columns={[{ label: t(`${C}.counselor`) }, received()]} rows={report.by_counselor.map((r) => [counselorLabel(r.name), r.received])} />
      <Section title={t(`${D}.sections.outcomes`)} columns={[{ label: t(`${C}.outcome`) }, count()]} rows={report.outcomes.map((r) => [outcomeLabel(r), r.count])} />
      <Section title={t(`${D}.sections.professionals`)} columns={[{ label: t(`${C}.professional`) }, matches()]} rows={report.by_professional.map((r) => [professionalLabel(r.name), r.matched])} />
      <Section
        title={t(`${D}.sections.professionalsWeeks`)}
        columns={[{ label: t(`${C}.week`) }, { label: t(`${C}.professional`) }, matches()]}
        rows={report.by_professional_week.map((r) => [weekLabel(r.week_start, period), professionalLabel(r.name), r.matched])}
      />
      <Section title={t(`${D}.sections.clienteles`)} columns={[{ label: t(`${C}.clientele`) }, matches()]} rows={report.by_clientele.map((r) => [clienteleLabel(r.name), r.matched])} />
    </div>
  )
}

function Sources({ report }: { report: DemandesReport }) {
  if (report.totals.received === 0) return <EmptyState title={t(`${D}.emptyReceived`)} />
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t(`${D}.sourcesHelp`)}</p>
      <Section title={t(`${D}.sections.sources`)} columns={[{ label: t(`${C}.source`) }, received(), matchedSince()]} rows={report.by_source.map((r) => [sourceLabel(r.name), r.received, r.matched])} />
      <Section
        title={t(`${D}.sections.campaigns`)}
        columns={[{ label: t(`${C}.campaign`) }, received(), matchedSince()]}
        rows={report.by_campaign.map((r) => [campaignLabel(r), r.received, r.matched])}
        empty={t(`${D}.noCampaign`)}
      />
      <Section title={t(`${D}.sections.utm`)} columns={[{ label: t(`${C}.utm`) }, received(), matchedSince()]} rows={report.by_utm.map((r) => [utmLabel(r), r.received, r.matched])} empty={t(`${D}.noUtm`)} />
      <Section
        title={t(`${D}.sections.referrers`)}
        columns={[{ label: t(`${C}.referrer`) }, received(), matchedSince()]}
        rows={report.by_referrer.map((r) => [referrerLabel(r), r.received, r.matched])}
        empty={t(`${D}.noReferrer`)}
      />
    </div>
  )
}

function Delays({ report, period }: { report: DemandesReport; period: Bounds }) {
  const d = report.delays
  const f = report.first_appointments
  return (
    <div className="space-y-5">
      <Section
        title={t(`${D}.sections.delays`)}
        columns={[{ label: t(`${C}.step`) }, { label: t(`${C}.median`), numeric: true }, { label: t(`${C}.average`), numeric: true }, { label: t(`${C}.requests`), numeric: true }]}
        rows={[
          [t(`${D}.delays.firstContact`), formatBusinessDays(d.first_contact_hours.median), formatBusinessDays(d.first_contact_hours.average), d.first_contact_hours.count],
          [t(`${D}.delays.proposal`), formatDays(d.proposal_days.median), formatDays(d.proposal_days.average), d.proposal_days.count],
          [t(`${D}.delays.match`), formatDays(d.match_days.median), formatDays(d.match_days.average), d.match_days.count],
        ]}
      />
      <h2 className="text-sm font-semibold text-foreground">{t(`${D}.sections.firstAppointments`)}</h2>
      <p className="text-sm text-muted-foreground">{t(`${D}.first.help`)}</p>
      <Totals
        label={t(`${D}.sections.firstAppointments`)}
        items={[
          { label: t(`${D}.first.matched`), value: String(f.matched) },
          { label: t(`${D}.first.cancelled`), value: String(f.cancelled) },
          { label: t(`${D}.first.rate`), value: formatRate(f.rate) },
          { label: t(`${D}.first.noticeAverage`), value: formatHours(f.notice_hours.average) },
          { label: t(`${D}.first.leadAverage`), value: formatDays(f.lead_days.average) },
        ]}
      />
      <Section
        title={t(`${D}.sections.firstRanges`)}
        columns={[{ label: t(`${C}.measure`) }, { label: t(`${C}.average`), numeric: true }, { label: t(`${C}.min`), numeric: true }, { label: t(`${C}.max`), numeric: true }]}
        rows={
          f.cancelled === 0
            ? []
            : [
                [t(`${D}.first.notice`), formatHours(f.notice_hours.average), formatHours(f.notice_hours.min), formatHours(f.notice_hours.max)],
                [t(`${D}.first.lead`), formatDays(f.lead_days.average), formatDays(f.lead_days.min), formatDays(f.lead_days.max)],
              ]
        }
        empty={t(`${D}.first.none`)}
      />
      <Section
        title={t(`${D}.sections.firstWeeks`)}
        columns={[{ label: t(`${C}.week`) }, count()]}
        rows={f.cancelled === 0 ? [] : report.weeks.map((w) => [weekLabel(w.week_start, period), w.first_cancelled])}
        empty={t(`${D}.first.none`)}
      />
      <Section title={t(`${D}.sections.firstReasons`)} columns={[{ label: t(`${C}.reason`) }, count()]} rows={f.by_reason.map((r) => [reasonLabel(r.name), r.count])} empty={t(`${D}.first.none`)} />
      <Section
        title={t(`${D}.sections.firstProfessionals`)}
        columns={[{ label: t(`${C}.professional`) }, count()]}
        rows={f.by_professional.map((r) => [professionalLabel(r.name), r.count])}
        empty={t(`${D}.first.none`)}
      />
    </div>
  )
}

function Waitlist({ report, period }: { report: DemandesReport; period: Bounds }) {
  const w = report.waitlist
  const p = report.places
  return (
    <div className="space-y-5">
      <Totals
        label={t(`${D}.sections.waitlist`)}
        items={[
          { label: t(`${D}.waitlist.waiting`), value: String(w.waiting_total) },
          { label: t(`${D}.waitlist.incomplete`), value: String(w.incomplete_total) },
          { label: t(`${D}.waitlist.registered`), value: String(w.registered) },
          { label: t(`${D}.waitlist.placed`), value: String(w.wait_days.count) },
          { label: t(`${D}.waitlist.waitMedian`), value: formatDays(w.wait_days.median) },
          { label: t(`${D}.waitlist.waitAverage`), value: formatDays(w.wait_days.average) },
        ]}
      />
      <Section
        title={t(`${D}.sections.lists`)}
        columns={[{ label: t(`${C}.list`) }, { label: t(`${C}.waiting`), numeric: true }, { label: t(`${C}.incomplete`), numeric: true }, { label: t(`${C}.priority`), numeric: true }]}
        rows={w.open.map((r) => [listLabel(r), r.waiting, r.incomplete, r.priority])}
        empty={t(`${D}.waitlist.nobody`)}
      />
      <Section title={t(`${D}.sections.exits`)} columns={[{ label: t(`${C}.reason`) }, count()]} rows={w.exits.map((r) => [exitReasonLabel(r.reason), r.count])} empty={t(`${D}.waitlist.noExit`)} />
      <h2 className="text-sm font-semibold text-foreground">{t(`${D}.sections.places`)}</h2>
      {p.snapshot_on === null ? (
        <p className="text-sm text-muted-foreground">{t(`${D}.places.none`)}</p>
      ) : (
        <>
          <p className="text-sm text-foreground">
            {t(p.total_left <= 1 ? `${D}.places.summaryOne` : `${D}.places.summary`, {
              date: formatDateOnlyShort(p.snapshot_on),
              left: String(p.total_left),
              tracked: String(p.tracked),
            })}
          </p>
          <Section
            title={t(`${D}.sections.placesByProfessional`)}
            columns={[{ label: t(`${C}.professional`) }, { label: t(`${C}.declared`), numeric: true }, { label: t(`${C}.left`), numeric: true }, { label: t(`${C}.accepting`) }]}
            rows={p.by_professional.map((r) => [professionalLabel(r.name), r.declared, r.left, r.accepting ? t(`${D}.places.accepts`) : t(`${D}.places.doesNotAccept`)])}
          />
          <Section
            title={t(`${D}.sections.placesWeeks`)}
            columns={[{ label: t(`${C}.week`) }, { label: t(`${C}.snapshot`) }, { label: t(`${C}.left`), numeric: true }]}
            rows={p.weeks.map((r) => [weekLabel(r.week_start, period), formatDateOnlyShort(r.snapshot_on), r.total_left])}
          />
        </>
      )}
    </div>
  )
}
