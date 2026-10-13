import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { DemandeState, InboxRow, Promise_ } from '../api/demandes'

const D = 'modules.demandes'

/** The record's tabs: their URL segments, in order. */
/** « Jumelage » (D4) shows with professionals.view only (the panel names « Bon à savoir »). */
export const RECORD_TABS = ['accueil', 'participants', 'suivi', 'jumelage', 'historique'] as const
export type RecordTab = (typeof RECORD_TABS)[number]

export const demandePath = (id: string, tab: RecordTab = 'accueil') => `/demandes/${id}/${tab}`

/** The moves the database allows (D-2: `private.demande_state_allowed`). */
const MOVES: Record<DemandeState, DemandeState[]> = {
  new: ['evaluating', 'accepted', 'waitlist', 'closed'],
  evaluating: ['new', 'accepted', 'waitlist', 'closed'],
  accepted: ['evaluating', 'proposed', 'waitlist', 'closed'],
  proposed: ['accepted', 'waitlist', 'closed'],
  matched: ['accepted', 'closed'],
  waitlist: ['accepted', 'proposed', 'closed'],
  closed: ['new', 'evaluating'],
}

/** Where a request can go from `state` (« Jumelée » needs the matching panel, D4: not offered here). */
export function nextStates(state: DemandeState): DemandeState[] {
  return MOVES[state]
}

export const stateLabel = (state: string) => t(`${D}.states.${state}` as never)

export function stateTone(state: DemandeState): StatusTone {
  switch (state) {
    case 'new':
      return 'info'
    case 'matched':
      return 'success'
    case 'closed':
      return 'neutral'
    case 'waitlist':
      return 'warning'
    default:
      return 'default'
  }
}

/** The promise (24–48 h ouvrables) in plain words, and its tone. */
export function promiseText(promise: Promise_, hours: number): { label: string; tone: StatusTone } {
  const h = String(Math.floor(hours))
  switch (promise) {
    case 'late':
      return { label: t(`${D}.promise.late`, { hours: h }), tone: 'error' }
    case 'soon':
      return { label: t(`${D}.promise.soon`, { hours: h }), tone: 'warning' }
    case 'ok':
      return { label: hours < 1 ? t(`${D}.promise.fresh`) : t(`${D}.promise.ok`, { hours: h }), tone: 'default' }
    case 'met':
      return { label: t(`${D}.promise.met`), tone: 'success' }
    case 'met_late':
      return { label: t(`${D}.promise.metLate`), tone: 'warning' }
    case 'none':
      return { label: t(`${D}.promise.none`), tone: 'neutral' }
  }
}

/** Who the request is for, or how to reach them. */
export function personLabel(row: Pick<InboxRow, 'person_name'>): string {
  return row.person_name?.trim() || t(`${D}.unnamed`)
}

export const fileLabel = (number: number, name: string) => t(`${D}.file`, { number: String(number), name })

export const optionLabel = (group: string, value: string) => t(`${D}.options.${group}.${value}` as never)
