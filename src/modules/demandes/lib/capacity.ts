import { t } from '@/i18n'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import type { CapacityRow } from '../api/capacity'

const C = 'modules.demandes.capacity'

export const CAPACITY_VIEWS = ['all', 'places', 'full', 'untracked'] as const
export type CapacityView = (typeof CAPACITY_VIEWS)[number]
/** The view in the address (`?vue=`), in French. */
export const CAPACITY_VIEW_PARAM: Record<CapacityView, string> = { all: 'tous', places: 'avec-places', full: 'complets', untracked: 'non-suivis' }

export function inView(row: CapacityRow, view: CapacityView): boolean {
  switch (view) {
    case 'places':
      return row.places_left !== null && row.places_left > 0
    case 'full':
      return row.places_left === 0
    case 'untracked':
      return row.places_declared === null
    default:
      return true
  }
}

/** « 2 sur 3 places restantes », « 0 sur 2 places restantes » (a warning), « Non suivies ». */
export function placesText(row: CapacityRow): { label: string; tone: 'neutral' | 'warning'; since: string | null } {
  if (row.places_declared === null || row.places_left === null) return { label: t(`${C}.untracked`), tone: 'neutral', since: null }
  return {
    label: t(`${C}.placesOf`, { left: String(row.places_left), declared: String(row.places_declared) }),
    tone: row.places_left === 0 ? 'warning' : 'neutral',
    since: row.places_set_at ? t(`${C}.since`, { date: formatClinicDateShort(row.places_set_at), used: String(row.places_used ?? 0) }) : null,
  }
}
