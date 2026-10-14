import { t } from '@/i18n'
import { centsLabel } from './display'

/**
 * A PAE agreement's tiers (R-85, Christine 20): its first sessions of the year covered otherwise
 * than its usual coverage, e.g. « 3 séances à 100 %, puis 50 % ». The tiers come in order; the
 * agreement's usual coverage (an amount per session or a share, FP-1) is the open-ended last one.
 * Facturation counts the sessions already covered in the agreement's year; its maximum still caps
 * every tier.
 */
export interface CoverageTier {
  sessions: number
  /** A share of the session (1–100), or… */
  coveragePercent: number | null
  /** … an amount per session (cents). */
  sessionAmountCents: number | null
}

/** At most this many tiers before the usual coverage (the database's limit). */
export const MAX_TIERS = 5

const C = 'modules.clients.record.coverage'

/** Typed dollars (« 94,50 ») → cents; null for empty; NaN for unreadable. */
export function dollarsToCents(value: string): number | null {
  const compact = value.replace(/[\s$]/g, '').replace(',', '.')
  if (compact === '') return null
  return /^[0-9]+(\.[0-9]{1,2})?$/.test(compact) ? Math.round(Number(compact) * 100) : Number.NaN
}

/** « 100 % » or « 60,00 $ »; null without either. */
export function coverageLabel(sessionAmountCents: number | null, coveragePercent: number | null): string | null {
  if (coveragePercent !== null) return t(`${C}.percent`, { value: String(coveragePercent) })
  if (sessionAmountCents !== null) return centsLabel(sessionAmountCents)
  return null
}

/**
 * The tiers in plain French: « 3 premières séances : 100 % ; ensuite : 50 % », « Première séance :
 * 80,00 $ ; 2 séances suivantes : 50 % ; ensuite : 30,00 $ ». Null without tiers.
 */
export function tiersText(tiers: readonly CoverageTier[], sessionAmountCents: number | null, coveragePercent: number | null): string | null {
  if (tiers.length === 0) return null
  const parts = tiers.map((tier, index) => {
    const span =
      index === 0
        ? tier.sessions === 1
          ? t(`${C}.tiersFirstOne`)
          : t(`${C}.tiersFirst`, { count: String(tier.sessions) })
        : tier.sessions === 1
          ? t(`${C}.tiersNextOne`)
          : t(`${C}.tiersNext`, { count: String(tier.sessions) })
    return t(`${C}.tierPart`, { span, coverage: coverageLabel(tier.sessionAmountCents, tier.coveragePercent) ?? '' })
  })
  const then = coverageLabel(sessionAmountCents, coveragePercent)
  if (then) parts.push(t(`${C}.tierPart`, { span: t(`${C}.tiersThen`), coverage: then }))
  return parts.join(' ; ')
}

/** A tier as the agreement form edits it: the number of sessions and an amount or a share, as typed. */
export interface TierRow {
  sessions: string
  mode: 'amount' | 'percent'
  value: string
}

export const tierRow = (tier: CoverageTier): TierRow => ({
  sessions: String(tier.sessions),
  mode: tier.coveragePercent !== null ? 'percent' : 'amount',
  value: tier.coveragePercent !== null ? String(tier.coveragePercent) : ((tier.sessionAmountCents ?? 0) / 100).toFixed(2).replace('.', ','),
})

/**
 * The form's rows → the tiers to save, or null when one is not readable: a whole number of
 * sessions (1–999), and a share from 1 to 100 % or an amount in dollars (at most 10 000 $).
 */
export function parseTierRows(rows: readonly TierRow[]): CoverageTier[] | null {
  const tiers: CoverageTier[] = []
  for (const row of rows) {
    const sessions = /^[0-9]{1,3}$/.test(row.sessions.trim()) ? Number(row.sessions.trim()) : Number.NaN
    if (!Number.isInteger(sessions) || sessions < 1) return null
    if (row.mode === 'percent') {
      const percent = /^[0-9]{1,3}$/.test(row.value.trim()) ? Number(row.value.trim()) : Number.NaN
      if (!Number.isInteger(percent) || percent < 1 || percent > 100) return null
      tiers.push({ sessions, coveragePercent: percent, sessionAmountCents: null })
    } else {
      const cents = dollarsToCents(row.value)
      if (cents === null || Number.isNaN(cents) || cents > 1_000_000) return null
      tiers.push({ sessions, coveragePercent: null, sessionAmountCents: cents })
    }
  }
  return tiers
}
