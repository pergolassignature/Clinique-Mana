import type { AgendaAppointment, AvailabilityException, AvailabilityRule } from '../api/parse'
import { DEFAULT_GRID, isoWeekday, minutesOf, minutesOnDay, type GridRange } from './time'

/** An item placed in a day column: its minutes and its lane among overlapping ones. */
export interface Placed<T> {
  item: T
  start: number
  end: number
  lane: number
  lanes: number
}

/**
 * Lane packing for a day column (pure): items sorted by start, each in the first lane free at
 * its start; every item of a group of overlapping ones knows the group's lane count.
 */
export function packLanes<T>(items: readonly { item: T; start: number; end: number }[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const placed: Placed<T>[] = []
  let group: Placed<T>[] = []
  let groupEnd = -1
  const laneEnds: number[] = []
  const close = () => {
    const lanes = Math.max(1, ...group.map((p) => p.lane + 1))
    for (const p of group) p.lanes = lanes
    group = []
    laneEnds.length = 0
  }
  for (const it of sorted) {
    if (it.start >= groupEnd) close()
    let lane = laneEnds.findIndex((end) => end <= it.start)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = it.end
    const p: Placed<T> = { ...it, lane, lanes: 1 }
    group.push(p)
    placed.push(p)
    groupEnd = Math.max(groupEnd, it.end)
  }
  close()
  return placed
}

/** The appointments of a day column, placed (the « pause après » not drawn: the session only). */
export function placeAppointments(appointments: readonly AgendaAppointment[], day: string): Placed<AgendaAppointment>[] {
  return packLanes(
    appointments
      .map((a) => ({ item: a, start: minutesOnDay(a.startsAt, day), end: minutesOnDay(a.endsAt, day) }))
      .filter((p) => p.end > p.start && p.end > 0 && p.start < 24 * 60),
  )
}

/** The windows of a professional on `day` (weekday, validity), as minutes. */
export function windowsOn(rules: readonly AvailabilityRule[], professionalId: string, day: string): { rule: AvailabilityRule; start: number; end: number }[] {
  const weekday = isoWeekday(day)
  return rules
    .filter((r) => r.professionalId === professionalId && r.weekday === weekday && r.validFrom <= day && (r.validUntil === null || day <= r.validUntil))
    .map((rule) => ({ rule, start: minutesOf(rule.startTime), end: minutesOf(rule.endTime) }))
}

/** The exceptions of a professional overlapping `day`, clipped to it. */
export function exceptionsOn(exceptions: readonly AvailabilityException[], professionalId: string, day: string): { exception: AvailabilityException; start: number; end: number }[] {
  return exceptions
    .filter((e) => e.professionalId === professionalId)
    .map((exception) => ({ exception, start: minutesOnDay(exception.startsAt, day), end: minutesOnDay(exception.endsAt, day) }))
    .filter((e) => e.end > e.start)
}

/** Top and height of a [start, end) range in a grid of `hourHeight` px per hour, clipped to the grid's `range`. */
export function verticalBox(start: number, end: number, hourHeight: number, range: GridRange = DEFAULT_GRID): { top: number; height: number } {
  const s = Math.max(start, range.start)
  const e = Math.min(end, range.end)
  return { top: ((s - range.start) / 60) * hourHeight, height: Math.max(((e - s) / 60) * hourHeight, 0) }
}
