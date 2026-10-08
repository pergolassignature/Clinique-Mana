import type { RetentionStatus, ReviewRow, SessionEntryInput } from '../api/compensation'
import { parseSessions } from './compensation'

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

export const REVIEW_FILTERS = ['gap', 'all', 'conforme', 'maintained', 'custom', 'floor', 'profession_unconfirmed'] as const
export type ReviewFilter = (typeof REVIEW_FILTERS)[number]

/** The rows a filter keeps; a row being edited always stays, so typing never hides it. */
export function filterRows(rows: readonly ReviewRow[], filter: ReviewFilter, drafts: Drafts): ReviewRow[] {
  return rows.filter((row) => filter === 'all' || row.status === filter || drafts[row.id] !== undefined)
}

/** Rows per status, for the filter's labels. */
export function countByStatus(rows: readonly ReviewRow[]): Record<RetentionStatus, number> {
  const counts: Record<RetentionStatus, number> = { gap: 0, conforme: 0, floor: 0, maintained: 0, custom: 0, profession_unconfirmed: 0 }
  for (const row of rows) counts[row.status] += 1
  return counts
}
