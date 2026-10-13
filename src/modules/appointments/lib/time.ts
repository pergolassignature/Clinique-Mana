import { clinicTimeToUTC, getClinicDateString, getClinicTimeString } from '@/shared/lib/timezone'

/**
 * The agenda's calendar arithmetic, pure. Days are clinic dates (`yyyy-MM-dd`), never a
 * browser-local Date; an instant is placed on the grid by its clinic date and clock time, so
 * 9:00 stays on the 9:00 line across a daylight-saving change (R2 acceptance).
 */

/**
 * The grid: 6:00 to 22:00 by default (as the legacy agenda), 15-minute snapping (plan R2). The
 * appointments' grid widens to any appointment outside it (`gridRangeFor`): one is never hidden.
 */
export const GRID_START = 6 * 60
export const GRID_END = 22 * 60
export const SNAP = 15

/** The minutes a grid shows, [start, end), on whole hours. */
export interface GridRange {
  start: number
  end: number
}

export const DEFAULT_GRID: GridRange = { start: GRID_START, end: GRID_END }

/** The default range widened, by whole hours, to every [start, end) given (within the day). */
export function gridRangeFor(spans: readonly { start: number; end: number }[]): GridRange {
  let start = GRID_START
  let end = GRID_END
  for (const span of spans) {
    if (span.end <= span.start) continue
    start = Math.min(start, Math.floor(span.start / 60) * 60)
    end = Math.max(end, Math.ceil(span.end / 60) * 60)
  }
  return { start: Math.max(0, start), end: Math.min(24 * 60, end) }
}

const parts = (day: string): [number, number, number] => {
  const [y, m, d] = day.split('-').map(Number)
  return [y!, m!, d!]
}
const fromUtc = (date: Date): string => date.toISOString().slice(0, 10)

/** `day` plus `n` days (calendar days: never 24-hour steps). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day)
  return fromUtc(new Date(Date.UTC(y, m - 1, d + n)))
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const [y, m, d] = parts(day)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w === 0 ? 7 : w
}

/** The Monday of `day`'s week. */
export function startOfWeek(day: string): string {
  return addDays(day, 1 - isoWeekday(day))
}

/** `n` consecutive days from `day`. */
export function daysFrom(day: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(day, i))
}

/** The 6 weeks shown for `day`'s month, Monday first. */
export function monthGrid(day: string): string[] {
  const [y, m] = parts(day)
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  return daysFrom(startOfWeek(first), 42)
}

/** Whether `day` is in the same month as `ref`. */
export const sameMonth = (day: string, ref: string) => day.slice(0, 7) === ref.slice(0, 7)

/** « HH:mm » for minutes since midnight. */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Minutes since midnight of « HH:mm » (or « HH:mm:ss »). */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h! * 60 + m!
}

/** The UTC instant of a clinic date and clock minutes. */
export function instantOf(day: string, minutes: number): string {
  return clinicTimeToUTC(day, hhmm(minutes))
}

/**
 * Where an instant falls on `day`'s column, in minutes since that day's midnight (clinic time):
 * before the day → 0, after it → 24 h.
 */
export function minutesOnDay(instant: string, day: string): number {
  const date = getClinicDateString(instant)
  if (date < day) return 0
  if (date > day) return 24 * 60
  return minutesOf(getClinicTimeString(instant))
}

/** Snaps minutes to the grid step. */
export const snap = (minutes: number, step = SNAP) => Math.round(minutes / step) * step

/** The clinic date range [from, to) as instants, for `list_agenda`. */
export function rangeOf(firstDay: string, days: number): { from: string; to: string } {
  return { from: instantOf(firstDay, 0), to: instantOf(addDays(firstDay, days), 0) }
}
