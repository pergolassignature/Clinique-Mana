import type { CalendarColumn, CalendarGridStringKey, CalendarLayer, GridItem } from '@pergolas-signature/calendar-ui'
import { t, type TranslationKey } from '@/i18n'
import type { ExternalBusy } from '../api/calendar'
import type { AgendaAppointment, AvailabilityException, AvailabilityRule } from '../api/parse'
import { busyOn, exceptionsOn, windowsOn } from './layout'
import { addDays, instantOf } from './time'

/*
 * The agenda's side of `@pergolas-signature/calendar-ui` (PS Hub's time grid, its ADR-0485 to ADR-0504):
 * how the appointments, the columns, the availability and the words become the grid's. Pure: the
 * ports and the view are in `components/TimeGrid.tsx`.
 *
 * - A day is the clinic's (`yyyy-MM-dd`): the grid gets its midnight in the clinic's zone and places
 *   every time by its clinic clock, so 9:00 stays on the 9:00 line across a daylight-saving change.
 * - A column's resource is its professional: « Jour » has one column per professional, a week of
 *   one professional seven of hers, a week of several seven without one (every appointment).
 */

/** An appointment on the grid: its instants and its professional, the appointment itself kept. */
export interface AgendaGridItem extends GridItem {
  appointment: AgendaAppointment
}

/** The agenda's column, as the page builds it (`TimeGrid`'s `GridColumn`). */
interface AgendaColumn {
  key: string
  day: string
  professionalId: string | null
  label: string
  sublabel?: string
}

/** A clinic date as the grid's day: its midnight in the clinic's zone. */
export const gridDay = (day: string): Date => new Date(instantOf(day, 0))

/** A clinic date and minutes since its midnight (24 h included: the next midnight) as an instant. */
function instantAt(day: string, minutes: number): Date {
  return minutes >= 24 * 60 ? new Date(instantOf(addDays(day, 1), minutes - 24 * 60)) : new Date(instantOf(day, minutes))
}

export function toGridItems(appointments: readonly AgendaAppointment[]): AgendaGridItem[] {
  return appointments.map((a) => ({
    id: a.id,
    start: new Date(a.startsAt),
    end: new Date(a.endsAt),
    allDay: false,
    resourceKey: a.professionalId,
    appointment: a,
  }))
}

export function toGridColumns(columns: readonly AgendaColumn[]): CalendarColumn[] {
  return columns.map((c) => ({ key: c.key, day: gridDay(c.day), resourceKey: c.professionalId, label: c.label, sublabel: c.sublabel }))
}

/** The days the columns cover, in order, once each. */
export function gridDays(columns: readonly AgendaColumn[]): Date[] {
  return [...new Set(columns.map((c) => c.day))].map(gridDay)
}

/**
 * The bands under the appointments, per column (R2, R6): the professional's windows shaded, her
 * exceptions hatched, her Google busy times « Occupé ». A column without a professional of its own
 * takes `shadeProfessionalId`'s, else none.
 */
export function toGridLayers(
  columns: readonly AgendaColumn[],
  input: {
    rules: readonly AvailabilityRule[]
    exceptions: readonly AvailabilityException[]
    busy: readonly ExternalBusy[]
    shadeProfessionalId: string | null
  },
): CalendarLayer[] {
  const busyLabel = t('modules.appointments.calendar.busy')
  return columns.flatMap((column) => {
    const shadeFor = column.professionalId ?? input.shadeProfessionalId
    if (!shadeFor) return []
    // A layer draws in the columns of its resource: this column's own (none in a week of several).
    const resourceKey = column.professionalId
    const at = (minutes: number) => instantAt(column.day, minutes)
    return [
      ...windowsOn(input.rules, shadeFor, column.day).map(({ rule, start, end }): CalendarLayer => ({
        key: `${column.key}:window:${rule.id}`,
        kind: 'shade',
        start: at(start),
        end: at(end),
        resourceKey,
      })),
      ...exceptionsOn(input.exceptions, shadeFor, column.day).map(({ exception, start, end }): CalendarLayer => ({
        key: `${column.key}:exception:${exception.id}`,
        kind: 'hatch',
        start: at(start),
        end: at(end),
        resourceKey,
      })),
      ...busyOn(input.busy, shadeFor, column.day).map(({ start, end }): CalendarLayer => ({
        key: `${column.key}:busy:${start}-${end}`,
        kind: 'busy',
        start: at(start),
        end: at(end),
        resourceKey,
        label: busyLabel,
      })),
    ]
  })
}

/** The grid's words live under this key of `fr-CA.json`, its `calendar.grid.` prefix dropped. */
const WORDS = 'modules.appointments.agenda.grid'
export const gridWordPath = (key: CalendarGridStringKey) => `${WORDS}.${key.slice('calendar.grid.'.length)}`

/** The grid's `t`: its key under `modules.appointments.agenda.grid`, every value as text. */
export function gridText(key: CalendarGridStringKey, values?: Record<string, unknown>): string {
  const path = gridWordPath(key) as TranslationKey
  if (!values) return t(path)
  return t(path, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])))
}
