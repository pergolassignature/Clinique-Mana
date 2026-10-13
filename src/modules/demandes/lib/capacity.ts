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

/** « 2 places restantes sur 3 », « 1 place restante sur 2 », « 0 place restante sur 2 » (a warning), « Non suivies ». */
export function placesText(row: CapacityRow): { label: string; tone: 'neutral' | 'warning'; since: string | null } {
  if (row.places_declared === null || row.places_left === null) return { label: t(`${C}.untracked`), tone: 'neutral', since: null }
  const values = { left: String(row.places_left), declared: String(row.places_declared) }
  const used = row.places_used ?? 0
  return {
    label: row.places_left > 1 ? t(`${C}.placesOfOther`, values) : t(`${C}.placesOfOne`, values),
    tone: row.places_left === 0 ? 'warning' : 'neutral',
    since: row.places_set_at
      ? t(used > 1 ? `${C}.sinceOther` : `${C}.sinceOne`, { date: formatClinicDateShort(row.places_set_at), used: String(used) })
      : null,
  }
}

/** « 12 places restantes chez 5 professionnels suivis », « 1 place restante chez 1 professionnel suivi ». */
export function totalText(left: number, tracked: number): string {
  const places = left > 1 ? t(`${C}.totalPlacesOther`, { count: String(left) }) : t(`${C}.totalPlacesOne`, { count: String(left) })
  const who = tracked > 1 ? t(`${C}.totalTrackedOther`, { count: String(tracked) }) : t(`${C}.totalTrackedOne`, { count: String(tracked) })
  return `${places} ${who}`
}
