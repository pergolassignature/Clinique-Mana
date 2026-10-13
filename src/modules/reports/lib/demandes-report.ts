import { t, type TranslationKey } from '@/i18n'
import { buildCsv, csvNumber, type CsvCell } from '@/shared/lib/csv'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import type { DemandesReport } from '../api/demandes-report'
import type { Period } from './reports'

const D = 'modules.reports.demandes'

export const DEMANDES_TABS = ['activity', 'sources', 'delays', 'waitlist'] as const
export type DemandesTab = (typeof DEMANDES_TABS)[number]

const decimals = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** « 66,7 % », or « Aucune donnée » when nothing was counted. */
export const formatRate = (value: number | null): string => (value == null ? t(`${D}.noData`) : `${decimals.format(value)}\u00A0%`)
/** « 37,5 h ouvrables ». */
export const formatBusinessHours = (value: number | null): string => (value == null ? t(`${D}.noData`) : t(`${D}.businessHours`, { value: decimals.format(value) }))
/** « 24,0 h ». */
export const formatHours = (value: number | null): string => (value == null ? t(`${D}.noData`) : t(`${D}.hours`, { value: decimals.format(value) }))
/** « 2,0 jours ». */
export const formatDays = (value: number | null): string => (value == null ? t(`${D}.noData`) : t(`${D}.days`, { value: decimals.format(value) }))

/** « Semaine du 31 août 2026 » (a calendar date: no time zone conversion). */
export const weekLabel = (day: string): string => t(`${D}.weekOf`, { date: formatDateOnlyShort(day) })

/** Demandes' own words for its codes (one vocabulary for the module and its report). */
export const channelLabel = (channel: string) => t(`modules.demandes.options.channel.${channel}` as TranslationKey)
export function outcomeLabel(row: { state: string; closed_reason: string | null }): string {
  const state = t(`modules.demandes.states.${row.state}` as TranslationKey)
  return row.state === 'closed' && row.closed_reason
    ? t(`${D}.closedBecause`, { state, reason: t(`modules.demandes.options.closedReason.${row.closed_reason}` as TranslationKey) })
    : state
}
export const exitReasonLabel = (reason: string | null) =>
  reason ? t(`modules.demandes.waitlist.exit.reasons.${reason}` as TranslationKey) : t(`${D}.noReason`)
export const counselorLabel = (name: string | null) => name ?? t(`${D}.noCounselor`)
export const sourceLabel = (name: string | null) => name ?? t(`${D}.noSource`)
export const clienteleLabel = (name: string | null) => name ?? t(`${D}.noClientele`)
export const utmLabel = (row: { source: string | null; medium: string | null }) =>
  [row.source ?? t(`${D}.noUtmSource`), row.medium ?? t(`${D}.noUtmMedium`)].join(' / ')

const maybe = (value: number | null): CsvCell => (value == null ? null : csvNumber(value))

/**
 * The tab shown, as a CSV (RP-6): one line per figure, « Section ; Indicateur ; Valeur », the same
 * figures as the screen (a rate in %, a delay in hours or days, as its label says).
 */
export function demandesCsv(report: DemandesReport, tab: DemandesTab, period: Period): { fileName: string; content: string } {
  const S = `${D}.sections`
  const L = `${D}.csv`
  const lines: CsvCell[][] = []
  const add = (section: string, label: string, value: number | null) => lines.push([t(`${S}.${section}` as TranslationKey), label, maybe(value)])
  const pair = (section: string, label: string, received: number, matched: number) => {
    add(section, t(`${L}.received`, { label }), received)
    add(section, t(`${L}.matched`, { label }), matched)
  }
  const stat = (section: string, label: string, s: { median: number | null; average: number | null; count: number }) => {
    add(section, t(`${L}.median`, { label }), s.median)
    add(section, t(`${L}.average`, { label }), s.average)
    add(section, t(`${L}.count`, { label }), s.count)
  }
  const x = report.totals
  if (tab === 'activity') {
    add('totals', t(`${D}.totals.received`), x.received)
    add('totals', t(`${D}.totals.matchedActivity`), x.matched_activity)
    add('totals', t(`${D}.totals.activityRate`), x.activity_rate)
    add('totals', t(`${D}.totals.matchedCohort`), x.matched_cohort)
    add('totals', t(`${D}.totals.cohortRate`), x.cohort_rate)
    add('totals', t(`${D}.totals.contactedOnTime`), x.contacted_on_time)
    add('totals', t(`${D}.totals.contactedLate`), x.contacted_late)
    add('totals', t(`${D}.totals.notContacted`), x.not_contacted)
    add('totals', t(`${D}.totals.waitlisted`), x.waitlisted)
    for (const w of report.weeks) pair('weeks', weekLabel(w.week_start), w.received, w.matched)
    for (const r of report.by_channel) pair('channels', channelLabel(r.channel), r.received, r.matched)
    for (const r of report.by_counselor) add('counselors', counselorLabel(r.name), r.received)
    for (const r of report.outcomes) add('outcomes', outcomeLabel(r), r.count)
    for (const r of report.by_professional) add('professionals', r.name ?? '', r.matched)
    for (const r of report.by_clientele) add('clienteles', clienteleLabel(r.name), r.matched)
  } else if (tab === 'sources') {
    for (const r of report.by_source) pair('sources', sourceLabel(r.name), r.received, r.matched)
    for (const r of report.by_campaign) pair('campaigns', r.name, r.received, r.matched)
    for (const r of report.by_utm) pair('utm', utmLabel(r), r.received, r.matched)
    for (const r of report.by_referrer) pair('referrers', r.host, r.received, r.matched)
  } else if (tab === 'delays') {
    const d = report.delays
    const f = report.first_appointments
    stat('delays', t(`${D}.delays.firstContact`), d.first_contact_hours)
    stat('delays', t(`${D}.delays.proposal`), d.proposal_days)
    stat('delays', t(`${D}.delays.match`), d.match_days)
    add('firstAppointments', t(`${D}.first.matched`), f.matched)
    add('firstAppointments', t(`${D}.first.cancelled`), f.cancelled)
    add('firstAppointments', t(`${D}.first.rate`), f.rate)
    add('firstAppointments', t(`${D}.first.noticeAverage`), f.notice_hours.average)
    add('firstAppointments', t(`${D}.first.noticeMin`), f.notice_hours.min)
    add('firstAppointments', t(`${D}.first.noticeMax`), f.notice_hours.max)
    for (const r of f.by_reason) add('firstReasons', r.name ?? t(`${D}.noReason`), r.count)
    for (const r of f.by_professional) add('firstProfessionals', r.name ?? '', r.count)
  } else {
    const w = report.waitlist
    const p = report.places
    add('waitlist', t(`${D}.waitlist.open`), w.open_total)
    add('waitlist', t(`${D}.waitlist.registered`), w.registered)
    stat('waitlist', t(`${D}.waitlist.wait`), w.wait_days)
    for (const r of w.open) {
      add('lists', t(`${L}.open`, { label: r.name ?? '' }), r.count)
      add('lists', t(`${L}.priority`, { label: r.name ?? '' }), r.priority)
    }
    for (const r of w.exits) add('exits', exitReasonLabel(r.reason), r.count)
    add('places', t(`${D}.places.totalLeft`), p.total_left)
    for (const r of p.by_professional) {
      add('places', t(`${L}.declared`, { label: r.name ?? '' }), r.declared)
      add('places', t(`${L}.left`, { label: r.name ?? '' }), r.left)
    }
    for (const r of p.weeks) add('placesWeeks', weekLabel(r.week_start), r.total_left)
  }
  const C = `${D}.columns`
  return {
    fileName: t(`${D}.fileName`, { tab: t(`${D}.fileTabs.${tab}`), from: period.from, to: period.to }),
    content: buildCsv([t(`${C}.section`), t(`${C}.label`), t(`${C}.value`)], lines),
  }
}
