/** The editor's draft of a series (AP-16): every 1–12 weeks, on weekdays, N appointments or until a date. */
export interface SeriesDraft {
  repeat: boolean
  intervalWeeks: number
  weekdays: number[]
  endKind: 'count' | 'until'
  count: string
  until: string
  skipConflicts: boolean
}

export const emptySeries = (weekday: number): SeriesDraft => ({
  repeat: false,
  intervalWeeks: 1,
  weekdays: [weekday],
  endKind: 'count',
  count: '10',
  until: '',
  skipConflicts: false,
})

/** The count when valid (2–52), else null. */
export function seriesCount(draft: SeriesDraft): number | null {
  const n = Number(draft.count)
  return draft.endKind === 'count' && Number.isInteger(n) && n >= 2 && n <= 52 ? n : null
}

/** Whether the rule is complete enough to preview. */
export const seriesComplete = (draft: SeriesDraft) =>
  draft.weekdays.length > 0 && (draft.endKind === 'count' ? seriesCount(draft) !== null : draft.until !== '')
