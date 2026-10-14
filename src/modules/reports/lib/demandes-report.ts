import { t, type TranslationKey } from '@/i18n'
import { buildCsv, csvNumber, type CsvCell } from '@/shared/lib/csv'
import { formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'
import type { DemandesReport } from '../api/demandes-report'
import type { Period } from './reports'

const D = 'modules.reports.demandes'

export const DEMANDES_TABS = ['activity', 'sources', 'delays', 'waitlist'] as const
export type DemandesTab = (typeof DEMANDES_TABS)[number]

const decimals = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const NO_DATA = () => t(`${D}.noData`)

/** « 66,7 % », or « Aucune donnée » when nothing was counted. */
export const formatRate = (value: number | null): string => (value == null ? NO_DATA() : `${decimals.format(value)}\u00A0%`)
/**
 * Business hours (24 per weekday, D-12) as business days: `37.5` → « 1,6 jour ouvrable »
 * (« 2 jours ouvrables » is the promise).
 */
export function formatBusinessDays(hours: number | null): string {
  if (hours == null) return NO_DATA()
  const days = hours / 24
  return t(days < 2 ? `${D}.businessDayOne` : `${D}.businessDays`, { value: decimals.format(days) })
}
/** « 24,0 h ». */
export const formatHours = (value: number | null): string => (value == null ? NO_DATA() : t(`${D}.hours`, { value: decimals.format(value) }))
/** « 2,0 jours ». */
export const formatDays = (value: number | null): string =>
  value == null ? NO_DATA() : t(value < 2 ? `${D}.dayOne` : `${D}.days`, { value: decimals.format(value) })

/** « Semaine du 31 août 2026 », « (partielle) » when the period cuts it (a calendar date: no time zone conversion). */
export function weekLabel(day: string, period?: { from: string; to: string }): string {
  const label = t(`${D}.weekOf`, { date: formatDateOnlyShort(day) })
  return period && (day < period.from || shiftCalendarDay(day, 6) > period.to) ? t(`${D}.partial`, { label }) : label
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
/** « Septembre 2026 », « (partiel) » when the period cuts it. */
export function monthLabel(day: string, period?: { from: string; to: string }): string {
  const [y, m] = day.split('-').map(Number) as [number, number]
  const name = MONTHS[m - 1] ?? ''
  const label = `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return period && (day < period.from || shiftCalendarDay(next, -1) > period.to) ? t(`${D}.partialMonth`, { label }) : label
}

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
export const professionalLabel = (name: string | null) => name ?? t(`${D}.noProfessional`)
export const reasonLabel = (name: string | null) => name ?? t(`${D}.noReason`)
/** A folded row (the values past the 50 biggest) reads « Autres valeurs ». */
export const otherLabel = () => t(`${D}.others`)
export function utmLabel(row: { source: string | null; medium: string | null; other: boolean }): string {
  if (row.other) return otherLabel()
  return [row.source ?? t(`${D}.noUtmSource`), row.medium ?? t(`${D}.noUtmMedium`)].join(' / ')
}
export const campaignLabel = (row: { name: string | null; other: boolean }) => (row.other ? otherLabel() : (row.name ?? ''))
export const referrerLabel = (row: { host: string | null; other: boolean }) => (row.other ? otherLabel() : (row.host ?? ''))
export const listLabel = (row: { target_kind: 'title' | 'professional'; name: string | null }) =>
  t(`${D}.waitlist.listKind.${row.target_kind}`, { name: row.name ?? t(`${D}.noName`) })

const maybe = (value: number | null): CsvCell => (value == null ? null : csvNumber(value))

/**
 * The tab shown, as a CSV (RP-6): one line per figure, « Section ; Indicateur ; Valeur », the same
 * figures as the screen (a rate in %, a delay in hours or days, as its label says).
 */
export function demandesCsv(report: DemandesReport, tab: DemandesTab, period: Period): { fileName: string; content: string } {
  const S = `${D}.sections`
  const L = `${D}.csv`
  const lines: CsvCell[][] = []
  const add = (section: string, label: string, value: number | null | string) =>
    lines.push([t(`${S}.${section}` as TranslationKey), label, typeof value === 'string' ? value : maybe(value)])
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
    add('totals', t(`${D}.totals.duplicates`), x.duplicates)
    add('totals', t(`${D}.totals.matchedActivity`), x.matched_activity)
    add('totals', t(`${D}.totals.activityRate`), x.activity_rate)
    add('totals', t(`${D}.totals.matchedCohort`), x.matched_cohort)
    add('totals', t(`${D}.totals.cohortRate`), x.cohort_rate)
    add('totals', t(`${D}.totals.contactedOnTime`), x.contacted_on_time)
    add('totals', t(`${D}.totals.contactedLate`), x.contacted_late)
    add('totals', t(`${D}.totals.pending`), x.pending)
    add('totals', t(`${D}.totals.overdue`), x.overdue)
    add('totals', t(`${D}.totals.noAttempt`), x.no_attempt)
    add('totals', t(`${D}.totals.waitlisted`), x.waitlisted)
    for (const w of report.weeks) {
      const label = weekLabel(w.week_start, period)
      add('weeks', t(`${L}.received`, { label }), w.received)
      add('weeks', t(`${L}.matchedInPeriod`, { label }), w.matched)
    }
    for (const m of report.months) {
      const label = monthLabel(m.month_start, period)
      add('months', t(`${L}.received`, { label }), m.received)
      add('months', t(`${L}.matchedInPeriod`, { label }), m.matched)
      add('months', t(`${L}.firstCancelled`, { label }), m.first_cancelled)
    }
    for (const r of report.by_channel) pair('channels', channelLabel(r.channel), r.received, r.matched)
    for (const r of report.by_counselor) add('counselors', counselorLabel(r.name), r.received)
    for (const r of report.outcomes) add('outcomes', outcomeLabel(r), r.count)
    for (const r of report.by_professional) add('professionals', professionalLabel(r.name), r.matched)
    for (const r of report.by_professional_week) {
      add('professionalsWeeks', `${weekLabel(r.week_start, period)} · ${professionalLabel(r.name)}`, r.matched)
    }
    for (const r of report.by_clientele) add('clienteles', clienteleLabel(r.name), r.matched)
  } else if (tab === 'sources') {
    for (const r of report.by_source) pair('sources', sourceLabel(r.name), r.received, r.matched)
    for (const r of report.by_campaign) pair('campaigns', campaignLabel(r), r.received, r.matched)
    for (const r of report.by_utm) pair('utm', utmLabel(r), r.received, r.matched)
    for (const r of report.by_referrer) pair('referrers', referrerLabel(r), r.received, r.matched)
  } else if (tab === 'delays') {
    const d = report.delays
    const f = report.first_appointments
    stat('delays', t(`${D}.delays.firstContactHours`), d.first_contact_hours)
    stat('delays', t(`${D}.delays.proposalDays`), d.proposal_days)
    stat('delays', t(`${D}.delays.matchDays`), d.match_days)
    add('firstAppointments', t(`${D}.first.matched`), f.matched)
    add('firstAppointments', t(`${D}.first.cancelled`), f.cancelled)
    add('firstAppointments', t(`${D}.first.rate`), f.rate)
    add('firstAppointments', t(`${D}.first.noticeAverage`), f.notice_hours.average)
    add('firstAppointments', t(`${D}.first.noticeMin`), f.notice_hours.min)
    add('firstAppointments', t(`${D}.first.noticeMax`), f.notice_hours.max)
    add('firstAppointments', t(`${D}.first.leadAverage`), f.lead_days.average)
    add('firstAppointments', t(`${D}.first.leadMin`), f.lead_days.min)
    add('firstAppointments', t(`${D}.first.leadMax`), f.lead_days.max)
    for (const w of report.weeks) add('firstWeeks', weekLabel(w.week_start, period), w.first_cancelled)
    for (const r of f.by_reason) add('firstReasons', reasonLabel(r.name), r.count)
    for (const r of f.by_professional) add('firstProfessionals', professionalLabel(r.name), r.count)
  } else {
    const w = report.waitlist
    const p = report.places
    add('waitlist', t(`${D}.waitlist.waiting`), w.waiting_total)
    add('waitlist', t(`${D}.waitlist.incomplete`), w.incomplete_total)
    add('waitlist', t(`${D}.waitlist.registered`), w.registered)
    stat('waitlist', t(`${D}.waitlist.wait`), w.wait_days)
    for (const r of w.open) {
      add('lists', t(`${L}.waiting`, { label: listLabel(r) }), r.waiting)
      add('lists', t(`${L}.incomplete`, { label: listLabel(r) }), r.incomplete)
      add('lists', t(`${L}.priority`, { label: listLabel(r) }), r.priority)
    }
    for (const r of w.exits) add('exits', exitReasonLabel(r.reason), r.count)
    add('places', t(`${D}.places.snapshotOn`), p.snapshot_on ?? t(`${D}.noData`))
    add('places', t(`${D}.places.totalLeft`), p.total_left)
    add('places', t(`${D}.places.tracked`), p.tracked)
    for (const r of p.by_professional) {
      add('places', t(`${L}.declared`, { label: professionalLabel(r.name) }), r.declared)
      add('places', t(`${L}.left`, { label: professionalLabel(r.name) }), r.left)
    }
    for (const r of p.weeks) add('placesWeeks', t(`${L}.snapshot`, { label: weekLabel(r.week_start, period), date: r.snapshot_on }), r.total_left)
  }
  const C = `${D}.columns`
  return {
    fileName: t(`${D}.fileName`, { tab: t(`${D}.fileTabs.${tab}`), from: period.from, to: period.to }),
    content: buildCsv([t(`${C}.section`), t(`${C}.label`), t(`${C}.value`)], lines),
  }
}
