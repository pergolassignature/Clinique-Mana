import { lastDayOf, taxRateStatus } from '@/core/settings/tax/rates'
import { parseRate } from '@/shared/lib/format'
import { t } from '@/i18n'
import { formatDateOnly, formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'
import type { Decision, Duration, PayLine, RetentionStatus } from '../api/compensation'

/**
 * Pure helpers of the retention program (P4-180…): percents, money and session counts as the
 * clinic reads and types them, months, and the rules of dated rows (grids, rates, decisions,
 * client agreements), which follow « Fiscalité »'s tax rates: `[effectiveFrom, effectiveTo)`, one
 * open row per series, the last row deletable while not in force yet or within 24 hours of its
 * creation (P4-145). Dates are date-only `yyyy-MM-dd` strings, compared as strings, never
 * through a timezone. Amounts are the database's: nothing here computes pay.
 */

/** A dated row of any compensation series. */
export interface DatedRow {
  id: string
  effectiveFrom: string
  /** Exclusive; null while the row is open (the series' last). */
  effectiveTo: string | null
  createdAt: string
}

export type DatedStatus = 'current' | 'upcoming' | 'ended'

/** Where a row stands on the clinic's `today` (same rule as the tax rates). */
export function datedStatus(row: Pick<DatedRow, 'effectiveFrom' | 'effectiveTo'>, today: string): DatedStatus {
  return taxRateStatus({ effective_from: row.effectiveFrom, effective_to: row.effectiveTo }, today)
}

/** The last day a closed row applies (the day before its exclusive end), or null while open. */
export const lastDay = (effectiveTo: string | null): string | null => lastDayOf(effectiveTo)

/** « Dès le 1 nov. 2026 » while open, « Du 1 janv. 2017 au 31 oct. 2026 » once closed (last day included). */
export function periodLabel(row: Pick<DatedRow, 'effectiveFrom' | 'effectiveTo'>): string {
  const from = formatDateOnlyShort(row.effectiveFrom)
  const end = lastDay(row.effectiveTo)
  return end === null
    ? t('modules.professionals.compensation.period.since', { from })
    : t('modules.professionals.compensation.period.between', { from, to: formatDateOnlyShort(end) })
}

/** The earliest start the `set_*` RPCs accept: the day after the open row's start; null without one. */
export function earliestStart(rows: readonly DatedRow[]): string | null {
  const open = rows.find((row) => row.effectiveTo === null)
  return open ? shiftCalendarDay(open.effectiveFrom, 1) : null
}

/** The rows of one key (a kind, a title), newest start first. */
export function rowsOf<R extends DatedRow>(rows: readonly R[], keep: (row: R) => boolean): R[] {
  return rows.filter(keep).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
}

/** The correction window of the delete RPCs: a row created less than this long ago can go. */
const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether the delete RPC will accept this row, so « Supprimer » shows only there: the series'
 * last row (`series` is newest first; the open one, or an ended agreement), not in force yet on
 * `today` or created less than 24 hours before `now` (ms). `keepFirst`: the clinic's other rates
 * keep their first row; grids, decisions and agreements do not. The database decides in the end.
 */
export function canDeleteDated(row: DatedRow, series: readonly DatedRow[], today: string, now: number, { keepFirst }: { keepFirst: boolean }): boolean {
  if (series.some((other) => other.effectiveFrom > row.effectiveFrom)) return false
  if (keepFirst && !series.some((other) => other.id !== row.id && other.effectiveTo === row.effectiveFrom)) return false
  if (row.effectiveFrom > today) return true
  const createdAt = Date.parse(row.createdAt)
  return !Number.isNaN(createdAt) && createdAt > now - CORRECTION_WINDOW_MS
}

// --- Percents (numeric(5, 2), 0–100) -----------------------------------------------------------------

const percentNumber = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 })

/** `28` → « 28 % », `27.5` → « 27,5 % » (a no-break space before the sign, as the tax rates). */
export function formatPercent(percent: number): string {
  return `${percentNumber.format(percent)}\u00A0%`
}

/** `27.5` → « 27,5 »: a stored percent as the rate fields take it (no sign, no grouping). */
export const percentInput = (percent: number): string => percentNumber.format(percent).replace(/\s/g, '')

/**
 * A typed percent (`28`, `27,5`, `27,5 %`) → the stored value, rounded to 2 decimals as
 * `numeric(5, 2)`; null when it is not a non-negative number (the range is the schema's job).
 */
export function parsePercent(input: string): number | null {
  const fraction = parseRate(input)
  return fraction === null ? null : Math.round(fraction * 1e4) / 100
}

// --- Money (cents) ---------------------------------------------------------------------------------

const dollars = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `12688` → « 126,88 $ » (no-break space before the sign, as the percents). */
export function formatCents(cents: number): string {
  return `${dollars.format(cents / 100)}\u00A0$`
}

const DOLLARS_INPUT = /^(?:[0-9]+(?:[.,][0-9]{0,2})?|[.,][0-9]{1,2})$/

/** Typed dollars (`175`, `126,88`, `85.00 $`, `1 000`) → cents; null for anything else (a third decimal included). */
export function parseDollars(input: string): number | null {
  const compact = input.replace(/\s/g, '').replace(/\$$/, '')
  if (!DOLLARS_INPUT.test(compact)) return null
  return Math.round(Number(compact.replace(',', '.')) * 100)
}

// --- Sessions ------------------------------------------------------------------------------------------

const sessionsNumber = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 })

/** `55.5` → « 55,5 ». */
export const formatSessions = (sessions: number): string => sessionsNumber.format(sessions)

const S = 'modules.professionals.compensation.sessionsCount'

/** « 0 séance », « 1,5 séance », « 2 séances »: French keeps the singular below 2. */
export const sessionsLabel = (sessions: number): string => t(Math.abs(sessions) < 2 ? `${S}.one` : `${S}.other`, { count: formatSessions(sessions) })

/**
 * The last whole count of a tier, the next tier's threshold less one (P4-198): « 51 à 100 », as
 * the clinic's sheet reads it. A count with a half session (100,5) stays in the tier until it
 * reaches the next threshold; the help text says so, the label does not.
 */
export const tierLastCount = (nextThreshold: number): number => nextThreshold - 1

/** A tier as a range of cumulative sessions: « 0 à 50 séances », « 501 séances et plus » (the last). */
export function tierRangeLabel(threshold: number, nextThreshold: number | null): string {
  return nextThreshold === null
    ? t('modules.professionals.compensation.tierRangeOpen', { from: sessionsLabel(threshold) })
    : t('modules.professionals.compensation.tierRange', { from: formatSessions(threshold), to: sessionsLabel(tierLastCount(nextThreshold)) })
}

/** A tier in a narrow cell: « 101–150 », « 501 et + » (read in full through `tierRangeLabel`). */
export function tierShortLabel(threshold: number, nextThreshold: number | null): string {
  return nextThreshold === null
    ? t('modules.professionals.compensation.tierShortOpen', { from: formatSessions(threshold) })
    : t('modules.professionals.compensation.tierShort', { from: formatSessions(threshold), to: formatSessions(tierLastCount(nextThreshold)) })
}

/** A month's count: a 50 or 60 minute session counts 1, a 30 minute one half (P4-186). */
export const monthCount = (long: number, short: number, adjustment = 0): number => long + short * 0.5 + adjustment

/** A typed count of sessions or an adjustment (`12`, `-3,5`): half steps; null for anything else. */
export function parseSessions(input: string, { signed, half }: { signed: boolean; half: boolean }): number | null {
  const compact = input.replace(/\s/g, '').replace(',', '.')
  const pattern = half ? (signed ? /^-?[0-9]+(?:\.[05])?$/ : /^[0-9]+(?:\.[05])?$/) : signed ? /^-?[0-9]+$/ : /^[0-9]+$/
  if (!pattern.test(compact)) return null
  const value = Number(compact)
  return Object.is(value, -0) ? 0 : value
}

/** The month rows with the cumulative total after each, oldest first then reversed (newest first). */
export function withRunningTotals<R extends { month: string; long: number; short: number; adjustment: number }>(rows: readonly R[]): (R & { total: number })[] {
  let total = 0
  return [...rows]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => {
      total += monthCount(row.long, row.short, row.adjustment)
      return { ...row, total }
    })
    .reverse()
}

// --- Months (`yyyy-MM-01`, date-only) -----------------------------------------------------------------

/** The first day of `date`'s month. */
export const monthOf = (date: string): string => `${date.slice(0, 7)}-01`

/** A month moved by `months` (negative: earlier). */
export function shiftMonth(month: string, months: number): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const index = year * 12 + (m - 1) + months
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

/** « octobre 2026 ». */
export const monthLabel = (month: string): string => formatDateOnly(month, 'MMMM yyyy')

// --- Labels ------------------------------------------------------------------------------------------

/** « 60 min / couple », « 50 min », « 30 min ». */
export const durationLabel = (duration: Duration): string => t(`modules.professionals.compensation.durations.${duration}`)

/**
 * What a status reads as (P4-197, Jonathan: « il faut toujours être clair »): a plain sentence per
 * situation. The database's `gap` splits in two — the count reached a tier the applied rate does
 * not follow yet (« Nouveau palier atteint »: the suggestion is lower, or the count passed the
 * tier the rate was decided at), or the rate simply differs from the grid (« Taux différent de la
 * grille »: a correction, a rate decided without a grid). `no_rate` is « Taux de départ à fixer »;
 * a decided increase (`increase_decided`, the review only) reads « Augmentation décidée ».
 */
export type RetentionDisplay =
  | 'newTier'
  | 'gridGap'
  | 'noRate'
  | 'increaseDecided'
  | 'floor'
  | 'conforme'
  | 'maintained'
  | 'custom'
  | 'professionUnconfirmed'

interface DisplayInput {
  status: RetentionStatus
  applied: { pct: number; tierThreshold: number | null } | null
  suggested: { threshold: number; pct: number } | null
}

export function retentionDisplay({ status, applied, suggested }: DisplayInput, increaseDecided = false): RetentionDisplay {
  switch (status) {
    case 'profession_unconfirmed':
      return 'professionUnconfirmed'
    case 'no_rate':
      return 'noRate'
    case 'gap': {
      const passedTier = applied !== null && suggested !== null && (suggested.pct < applied.pct || (applied.tierThreshold !== null && suggested.threshold > applied.tierThreshold))
      return passedTier ? 'newTier' : 'gridGap'
    }
    default:
      if (increaseDecided) return 'increaseDecided'
      return status
  }
}

/** Whether a status asks for a decision (the review's « À décider »). */
export const needsDecision = (status: RetentionStatus): boolean => status === 'gap' || status === 'no_rate'

/**
 * The sheet's colour cues, on design-system tokens (P4-190): yellow for a gap, blue for the
 * floor, green for an increase decided for the month; plain otherwise (a starting rate to fix
 * included: it has its own neutral mark, never the gap's yellow, P4-197).
 */
type RetentionTone = 'warning' | 'info' | 'success' | 'default'
export function retentionTone(display: RetentionDisplay): RetentionTone {
  if (display === 'newTier' || display === 'gridGap') return 'warning'
  if (display === 'increaseDecided') return 'success'
  if (display === 'floor') return 'info'
  return 'default'
}

const D = 'modules.professionals.compensation.decision'

/**
 * A decision's button carries its value (P4-197): « Appliquer 27 % », « Fixer à 30 % » (no rate
 * yet), « Maintenir 27,5 % », « Autre taux… » (a typed rate: custom, or a starting rate).
 */
export function decisionActionLabel(kind: Decision, appliedPct: number | null, suggestedPct: number | null): string {
  switch (kind) {
    case 'suggested':
      return t(appliedPct === null ? `${D}.action.setTo` : `${D}.action.apply`, { rate: suggestedPct === null ? '—' : formatPercent(suggestedPct) })
    case 'maintained':
      return t(`${D}.action.maintain`, { rate: appliedPct === null ? '—' : formatPercent(appliedPct) })
    case 'custom':
    case 'initial':
      return t(`${D}.action.other`)
  }
}

/** The decision dialog's title, with the same value as its button. */
export function decisionTitle(kind: Decision, appliedPct: number | null, suggestedPct: number | null): string {
  switch (kind) {
    case 'suggested':
    case 'maintained':
      return decisionActionLabel(kind, appliedPct, suggestedPct)
    case 'custom':
      return t(`${D}.title.custom`)
    case 'initial':
      return t(`${D}.title.initial`)
  }
}

/** One duration's pay before and after a decision, from the database's amounts (P4-189). */
export interface PayChange {
  duration: Duration
  /** Paid today (at the rate in force on the read's date), null without a rate. */
  beforeCents: number | null
  afterCents: number
}

/**
 * What a decision does to the pay per duration (P4-198): « Appliquer » pays the suggested amount,
 * « Maintenir » the latest decision's (upcoming, else in force). A typed rate is unknown until it
 * is stored: none. Durations the grid does not price are not in `pay`.
 */
export function payChanges(kind: Decision, pay: readonly PayLine[]): PayChange[] {
  if (kind !== 'suggested' && kind !== 'maintained') return []
  return pay.flatMap((line) => {
    const after = kind === 'suggested' ? line.suggestedCents : (line.upcomingCents ?? line.appliedCents)
    return after === null ? [] : [{ duration: line.duration, beforeCents: line.appliedCents, afterCents: after }]
  })
}
