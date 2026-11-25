import { useMemo, type ComponentType, type ReactNode } from 'react'
import type { CalendarGridPorts, CalendarHue, CalendarItemLook, MonthDayRowProps } from '@pergolas-signature/calendar-ui'
import { fr } from 'date-fns/locale'
import { Ban, Bell, BellOff, CircleCheck, Phone, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicTime, getClinicTimezone } from '@/shared/lib/timezone'
import type { AgendaAppointment } from '../api/parse'
import { gridText, type AgendaGridItem } from '../lib/calendar-grid'
import { appointmentTitle, isBusyOnly, reminderMarks, stateLabel } from '../lib/display'
import { GRID_END, GRID_START, HOUR_HEIGHT, hhmm } from '../lib/time'

const A = 'modules.appointments.agenda'

/**
 * What the agenda's grid and month hand `@pergolas-signature/calendar-ui` (PS Hub's, its ADR-0485 to
 * ADR-0515): the clinic's zone and Monday week, its hours, its words and its way of drawing an
 * appointment. `dayNote` is the month's line under a day's number (the birthdays), `dayRow` a row of
 * the phone month's day list.
 */
export function useAgendaGridPorts({
  professionalName,
  showProfessional,
  serviceColour,
  dayNote,
  dayRow,
}: {
  professionalName: (id: string) => string
  showProfessional: boolean
  /** A service's colour (Services et tarifs), drawn on the block's edge and tint; null for none. */
  serviceColour?: (serviceId: string | null) => string | null
  dayNote?: ComponentType<{ day: Date }>
  dayRow?: ComponentType<MonthDayRowProps<AgendaGridItem>>
}): CalendarGridPorts<AgendaGridItem> {
  return useMemo<CalendarGridPorts<AgendaGridItem>>(() => {
    const describe = (item: AgendaGridItem): CalendarItemLook => lookOf(item.appointment, { professionalName, showProfessional, serviceColour })
    return {
      useT: () => gridText,
      useDateLocale: () => fr,
      useDescribeItem: () => describe,
      timeZone: getClinicTimezone(),
      weekStartsOn: 1,
      hours: { start: GRID_START / 60, end: GRID_END / 60, widen: true, hourPx: HOUR_HEIGHT },
      hourLabel: (hour) => hhmm(hour * 60),
      slots: { MonthDayNote: dayNote, MonthDayRow: dayRow },
    }
  }, [professionalName, showProfessional, serviceColour, dayNote, dayRow])
}

/**
 * How the grid draws an appointment: its time, its marks and its names; its service's colour; held
 * hatched (« En attente d'acceptation »), cancelled dashed and struck, another professional's personal
 * appointment busy time. Its accessible name says the time, the names, the marks and a held state.
 */
export function lookOf(
  a: AgendaAppointment,
  opts: { professionalName: (id: string) => string; showProfessional: boolean; serviceColour?: (serviceId: string | null) => string | null },
): CalendarItemLook {
  const title = appointmentTitle(a)
  const marks = reminderMarks(a)
  const label = [
    t(`${A}.blockLabel`, { time: formatClinicTime(a.startsAt), title }),
    ...marks.map((mark) => t(`${A}.marks.${mark}`)),
    ...(a.state === 'held' || a.state === 'cancelled' ? [stateLabel(a.state)] : []),
  ].join(', ')
  return {
    name: title,
    kind: formatClinicTime(a.startsAt),
    label,
    barLabel: () => title,
    // A month line says what the block says (its marks and state too).
    lineLabel: label,
    status: null,
    quiet: false,
    hue: hueOf(a, opts.serviceColour?.(a.serviceId) ?? null),
    glyph: () => <BlockMarks appointment={a} />,
    recurring: Boolean(a.seriesId),
    // The third line, where it fits: the state of a held or cancelled one, else the professional in a week of several.
    detail:
      a.state === 'held' || a.state === 'cancelled'
        ? stateLabel(a.state)
        : opts.showProfessional
          ? opts.professionalName(a.professionalId)
          : undefined,
    inert: isBusyOnly(a),
    tone: a.state === 'held' ? 'tentative' : a.state === 'cancelled' ? 'cancelled' : undefined,
  }
}

/** The block's edge and tint: its service's colour, else the clinic's; a personal one grey. */
function hueOf(a: AgendaAppointment, colour: string | null): CalendarHue {
  if (a.isPersonal) return { hue: 'personal', colors: { edge: 'rgb(var(--border-strong))', tint: 'rgb(var(--muted))' } }
  const edge = colour ?? 'rgb(var(--primary))'
  return { hue: 'service', colors: { edge, tint: `color-mix(in srgb, ${edge} 10%, white)` } }
}

/** The marks before the time: by phone, outside the availability, cancelled, the reminder's. */
function BlockMarks({ appointment: a }: { appointment: AgendaAppointment }): ReactNode {
  const marks = reminderMarks(a)
  if (a.mode !== 'phone' && !a.outsideAvailability && a.state !== 'cancelled' && marks.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {a.mode === 'phone' && <Phone aria-hidden className="size-3" />}
      {a.outsideAvailability && <TriangleAlert aria-hidden className="size-3 text-warning" />}
      {a.state === 'cancelled' && <Ban aria-hidden className="size-3" />}
      {marks.map((mark) => {
        const Icon = mark === 'confirmed' ? CircleCheck : mark === 'reminded' ? Bell : BellOff
        return <Icon key={mark} aria-hidden className={mark === 'unreachable' ? 'size-3 shrink-0 text-warning' : 'size-3 shrink-0'} />
      })}
    </span>
  )
}
