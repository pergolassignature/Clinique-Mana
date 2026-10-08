import type { RetentionStatus, ReviewRow, SessionEntryInput } from '../api/compensation'
import { needsDecision, parseSessions } from './compensation'

/**
 * « Révision mensuelle » (P4-190): the month's typed sessions (drafts), the rows they change, and
 * the status filter. Pure, so the page stays a view.
 */

/** A row's typed counts and the version of the month's row when typing began (P4-163's rule). */
export interface SessionDraft {
  long: string
  short: string
  /** The month's `updated_at` read when the draft started (null: the month had no row). */
  version: string | null
}

export type Drafts = Readonly<Record<string, SessionDraft>>

/** What a row shows in its two fields: the draft, else the stored counts (blank when none). */
export function shownCounts(row: ReviewRow, drafts: Drafts): { long: string; short: string } {
  const draft = drafts[row.id]
  if (draft) return { long: draft.long, short: draft.short }
  return { long: row.entry ? String(row.entry.long) : '', short: row.entry ? String(row.entry.short) : '' }
}

/** A typed count: blank is 0; null when it is not a whole number from 0 to 2 000. */
export function draftCount(value: string): number | null {
  if (value.trim() === '') return 0
  const parsed = parseSessions(value, { signed: false, half: false })
  return parsed !== null && parsed <= 2000 ? parsed : null
}

/** Whether a draft says something other than what is stored. */
export function isChanged(row: ReviewRow, draft: SessionDraft | undefined): boolean {
  if (!draft) return false
  const long = draftCount(draft.long)
  const short = draftCount(draft.short)
  if (long === null || short === null) return true
  return long !== (row.entry?.long ?? 0) || short !== (row.entry?.short ?? 0)
}

/** Rows whose draft holds a count the RPC would refuse. */
export function invalidRows(rows: readonly ReviewRow[], drafts: Drafts): Set<string> {
  return new Set(
    rows
      .filter((row) => {
        const draft = drafts[row.id]
        return draft !== undefined && (draftCount(draft.long) === null || draftCount(draft.short) === null)
      })
      .map((row) => row.id),
  )
}

/**
 * The batch to send: one entry per changed row, its counts, and the version its draft started
 * from. The adjustment and the note are not sent: the month's stored ones are kept.
 */
export function changedEntries(rows: readonly ReviewRow[], drafts: Drafts): SessionEntryInput[] {
  return rows.flatMap((row) => {
    const draft = drafts[row.id]
    if (!draft || !isChanged(row, draft)) return []
    return [{ professionalId: row.id, long: draftCount(draft.long) ?? 0, short: draftCount(draft.short) ?? 0, expectedUpdatedAt: draft.version }]
  })
}

/** The live cumulative total of a row: the count before the month, plus the month as typed. */
export function liveTotal(row: ReviewRow, drafts: Drafts): number | null {
  const draft = drafts[row.id]
  if (!draft) return row.sessionsTotal
  const long = draftCount(draft.long)
  const short = draftCount(draft.short)
  if (long === null || short === null) return null
  return row.sessionsBefore + long + short * 0.5 + (row.entry?.adjustment ?? 0)
}

/**
 * The note `import_professional` gives the opening balance it writes in the month before the
 * import (P4-192): that month's « sessions » are the whole count so far, not the month's.
 */
export const IMPORTED_BALANCE_NOTE = 'Solde importé'

/** Whether the month's entry is only an imported opening balance (no session typed for it). */
export const isImportedBalance = (row: ReviewRow): boolean =>
  row.entry !== null && row.entry.long === 0 && row.entry.short === 0 && row.entry.adjustment !== 0 && row.entry.note === IMPORTED_BALANCE_NOTE

/**
 * Whether a month holds nothing but imported balances (at least one): the clinic has nothing to
 * review there yet, so the page opens on the current month instead.
 */
export function onlyImportedBalances(rows: readonly ReviewRow[]): boolean {
  const entered = rows.filter((row) => row.entry !== null)
  return entered.length > 0 && entered.every(isImportedBalance)
}

/**
 * « Afficher » (P4-199): « À décider » first (a gap or a starting rate to fix), then « Tous »,
 * « Conformes », « Palier maximum », and the rates that stand by decision (« Maintenus ou taux
 * particuliers ») and « Profession à confirmer » (offered when a row is in them).
 */
export const REVIEW_FILTERS = ['todo', 'all', 'conforme', 'floor', 'kept', 'profession_unconfirmed'] as const
export type ReviewFilter = (typeof REVIEW_FILTERS)[number]

/** Filters shown only when they hold a row (or are the one chosen). */
export const OPTIONAL_FILTERS: readonly ReviewFilter[] = ['kept', 'profession_unconfirmed']

function inFilter(status: RetentionStatus, filter: ReviewFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'todo':
      return needsDecision(status)
    case 'kept':
      return status === 'maintained' || status === 'custom'
    default:
      return status === filter
  }
}

/** The rows a filter keeps; a row being edited always stays, so typing never hides it. */
export function filterRows(rows: readonly ReviewRow[], filter: ReviewFilter, drafts: Drafts): ReviewRow[] {
  return rows.filter((row) => inFilter(row.status, filter) || drafts[row.id] !== undefined)
}

/** Rows per filter, for the filter's labels. */
export function countByFilter(rows: readonly ReviewRow[]): Record<ReviewFilter, number> {
  const counts = Object.fromEntries(REVIEW_FILTERS.map((filter) => [filter, 0])) as Record<ReviewFilter, number>
  for (const row of rows) for (const filter of REVIEW_FILTERS) if (inFilter(row.status, filter)) counts[filter] += 1
  return counts
}

/** Rows per status (« À décider »'s two counts: gaps, starting rates to fix). */
export function countByStatus(rows: readonly ReviewRow[]): Record<RetentionStatus, number> {
  const counts: Record<RetentionStatus, number> = { gap: 0, no_rate: 0, conforme: 0, floor: 0, maintained: 0, custom: 0, profession_unconfirmed: 0 }
  for (const row of rows) counts[row.status] += 1
  return counts
}
