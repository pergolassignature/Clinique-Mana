import { t } from '@/i18n'
import type { AvailabilityRule } from '../api/parse'
import { weekdayLabel } from './display'
import { GRID_END, GRID_START, SNAP } from './time'

/**
 * Availability by direct manipulation (AP-27), pure: what a drag on the grid makes of the
 * pointer's minutes (15-minute snapping, kept on the grid), and what the database will make of
 * the drop (`set_availability_window`): a window merged with the ones of the same settings it
 * touches or overlaps, refused over one with other settings. The preview only: the database
 * decides.
 */

export interface Range {
  start: number
  end: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const snapDown = (minutes: number) => Math.floor(minutes / SNAP) * SNAP
const snapNearest = (minutes: number) => Math.round(minutes / SNAP) * SNAP

/** Minutes for a pointer `offsetY` pixels below the grid's first line (6:00). */
export function minutesAtOffset(offsetY: number, hourHeight: number): number {
  return GRID_START + (offsetY / hourHeight) * 60
}

/** A pixel distance as whole quarter hours of minutes. */
export function snappedDelta(deltaY: number, hourHeight: number): number {
  return Math.round(((deltaY / hourHeight) * 60) / SNAP) * SNAP
}

/**
 * A drag from `anchor` to `current` (minutes, unsnapped): from the quarter hour where it started
 * to the quarter-hour line nearest the pointer, either way, one quarter hour at least, on the grid.
 */
export function rangeFromDrag(anchor: number, current: number): Range {
  const from = clamp(snapDown(anchor), GRID_START, GRID_END - SNAP)
  if (current >= from + SNAP) return { start: from, end: clamp(snapNearest(current), from + SNAP, GRID_END) }
  if (current < from) return { start: clamp(snapNearest(current), GRID_START, from), end: from + SNAP }
  return { start: from, end: from + SNAP }
}

/** A click without a drag: one hour from the quarter hour clicked (less at the grid's end). */
export function rangeFromClick(minutes: number): Range {
  const start = clamp(snapDown(minutes), GRID_START, GRID_END - SNAP)
  return { start, end: Math.min(start + 60, GRID_END) }
}

/** A window moved by `delta` minutes, kept on the grid (one already past an edge never pushed further). */
export function moveRange({ start, end }: Range, delta: number): Range {
  const d = clamp(delta, Math.min(0, GRID_START - start), Math.max(0, GRID_END - end))
  return { start: start + d, end: end + d }
}

/** One edge of a window moved by `delta` minutes: a quarter hour long at least, on the grid. */
export function resizeRange({ start, end }: Range, edge: 'start' | 'end', delta: number): Range {
  if (edge === 'start') return { start: clamp(start + delta, Math.min(start, GRID_START), end - SNAP), end }
  return { start, end: clamp(end + delta, start + SNAP, Math.max(end, GRID_END)) }
}

/** Another window of the day, and whether it has the same settings as the one dropped. */
export interface DayWindow extends Range {
  id: string
  compatible: boolean
}

export interface MergePreview extends Range {
  absorbed: string[]
  /** A window with other settings overlaps it: the database refuses. */
  conflict: boolean
}

/** What the drop makes: the compatible windows it touches or overlaps merged in (a chain too). */
export function previewMerge(others: readonly DayWindow[], candidate: Range): MergePreview {
  let { start, end } = candidate
  const absorbed = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const w of others) {
      if (!w.compatible || absorbed.has(w.id) || w.start > end || start > w.end) continue
      absorbed.add(w.id)
      start = Math.min(start, w.start)
      end = Math.max(end, w.end)
      grew = true
    }
  }
  const conflict = others.some((w) => !w.compatible && w.start < end && start < w.end)
  return { start, end, absorbed: [...absorbed], conflict }
}

/** Whether a range overlaps one of the day's exceptions (clipped to the day, in minutes). */
export function overlapsAny(ranges: readonly Range[], { start, end }: Range): boolean {
  return ranges.some((r) => r.start < end && start < r.end)
}

/**
 * The time a change adds to a day: all of it for a new window (or one moved from another day),
 * else what lies outside where it was. Only that may not cover an exception (one already inside a
 * window, « Bloquer » within it, never stops it from changing).
 */
export function addedParts(before: Range | null, after: Range): Range[] {
  if (!before) return [after]
  return [
    { start: after.start, end: Math.min(after.end, before.start) },
    { start: Math.max(after.start, before.end), end: after.end },
  ].filter((r) => r.start < r.end)
}

/** Whether two windows have the same settings (what merges): services, visibility, overflow, end of validity. */
export function sameSettings(a: Pick<AvailabilityRule, 'serviceIds' | 'visibleToClients' | 'overflowAllowed' | 'validUntil'>, b: typeof a): boolean {
  const sa = [...a.serviceIds].sort().join(',')
  const sb = [...b.serviceIds].sort().join(',')
  return sa === sb && a.visibleToClients === b.visibleToClients && a.overflowAllowed === b.overflowAllowed && a.validUntil === b.validUntil
}

/** The settings of a window made on the grid (every service, visible, no overflow). */
export const defaultSettings = (validUntil: string | null) => ({ serviceIds: [] as string[], visibleToClients: true, overflowAllowed: false, validUntil })

/** « 9 h », « 9 h 30 » (Québec). */
export function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

/** « mardi 9 h – 12 h ». */
export function windowPhrase(weekday: number, { start, end }: Range): string {
  return `${weekdayLabel(weekday).toLowerCase()} ${clockLabel(start)} – ${clockLabel(end)}`
}

/** « chaque semaine » or « cette semaine seulement ». */
export const repeatPhrase = (weekly: boolean) => t(weekly ? 'modules.appointments.availability.weekly' : 'modules.appointments.availability.thisWeekOnly')
