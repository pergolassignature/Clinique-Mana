import { useMemo } from 'react'
import { CalendarGridProvider, CalendarWeekView } from '@pergolas-signature/calendar-ui'
import { getClinicDateString } from '@/shared/lib/timezone'
import { PHONE_QUERY, useMediaQuery } from '@/shared/lib/use-media-query'
import { useNow } from '@/shared/lib/use-now'
import type { ExternalBusy } from '../api/calendar'
import type { AgendaAppointment, AvailabilityException, AvailabilityRule } from '../api/parse'
import { gridDays, toGridColumns, toGridItems, toGridLayers } from '../lib/calendar-grid'
import { DEFAULT_GRID, HOUR_HEIGHT, hhmm, minutesOnDay, type GridRange } from '../lib/time'
import { useAgendaGridPorts } from './agenda-grid-ports'

const hoursOf = (range: GridRange) => Array.from({ length: (range.end - range.start) / 60 }, (_, i) => range.start + i * 60)
/** From this width a column of « Jour » may take 128px; under it 96px, on a phone 176px (as before the grid moved). */
const XL_QUERY = '(min-width: 1280px)'

export interface GridColumn {
  key: string
  day: string
  /** The professional of the column (day view: one per professional); null in a week of several. */
  professionalId: string | null
  label: string
  sublabel?: string
}

interface TimeGridProps {
  columns: readonly GridColumn[]
  appointments: readonly AgendaAppointment[]
  rules: readonly AvailabilityRule[]
  exceptions: readonly AvailabilityException[]
  /** The professional whose availability is shaded when a column has none of its own. */
  shadeProfessionalId: string | null
  professionalName: (id: string) => string
  showProfessional: boolean
  canWrite: boolean
  onCreate: (day: string, minutes: number, professionalId: string | null) => void
  onOpen: (appointment: AgendaAppointment) => void
  onMove: (appointment: AgendaAppointment, startsAt: string) => void
  /** A service's colour (Services et tarifs), drawn on the block's left edge; null for none. */
  serviceColour?: (serviceId: string | null) => string | null
  /** The professionals' Google busy times (R6): « Occupé », never a title, nothing to open. */
  busy?: readonly ExternalBusy[]
  /** The phone's week strip picks a day (« Jour »). Absent, it only shows the week. */
  onDay?: (day: string) => void
}

/**
 * The agenda's time grid (plan R2) on PS Hub's `@pergolas-signature/calendar-ui` (stage 3a there):
 * columns of days or professionals, 6:00–22:00 at 48px an hour, widened by whole hours to any
 * appointment outside it (one is never hidden), every item placed by its clinic date and clock time
 * (`lib/calendar-grid`, so 9:00 stays on the 9:00 line across a daylight-saving change). The grid is
 * as tall as its hours and the page scrolls; many professionals scroll sideways, a column never under
 * 96px (128px from 1280px, 176px on a phone).
 *
 * Booking mode: availability windows shaded and exceptions hatched, a professional's Google busy times
 * « Occupé » (R6, times only); one click on an empty quarter hour creates an appointment there; an
 * appointment opens on click and moves by dragging (15-minute snapping), never resized (AP-33), the
 * move confirmed by the database. A held appointment is hatched, a cancelled one dashed and struck,
 * another professional's personal one busy time with nothing to open (AP-13). « Disponibilités » is
 * `AvailabilityGrid` (direct manipulation, AP-27), which keeps this file's rail, header and lines.
 * Blocks are buttons (keyboard: Tab then Entrée); creation also has the toolbar's button.
 */
export function TimeGrid(props: TimeGridProps) {
  const { columns, appointments, rules, exceptions, busy, shadeProfessionalId, professionalName, showProfessional, serviceColour, canWrite } = props
  const phone = useMediaQuery(PHONE_QUERY)
  const xl = useMediaQuery(XL_QUERY)
  const nowMs = useNow(60_000)
  const now = useMemo(() => new Date(nowMs), [nowMs])

  const gridColumns = useMemo(() => toGridColumns(columns), [columns])
  const days = useMemo(() => gridDays(columns), [columns])
  const items = useMemo(() => toGridItems(appointments), [appointments])
  const layers = useMemo(
    () => toGridLayers(columns, { rules, exceptions, busy: busy ?? [], shadeProfessionalId }),
    [columns, rules, exceptions, busy, shadeProfessionalId],
  )
  const ports = useAgendaGridPorts({ professionalName, showProfessional, serviceColour })

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <CalendarGridProvider ports={ports}>
        <CalendarWeekView
          days={days}
          columns={gridColumns}
          layers={layers}
          items={items}
          onSelectItem={(item) => props.onOpen(item.appointment)}
          onSelectDay={props.onDay ? (day) => props.onDay?.(getClinicDateString(day)) : undefined}
          isMobile={phone}
          now={now}
          isLoading={false}
          slotActivation="single"
          onSlotClick={
            canWrite
              ? (start, _anchor, column) => {
                  const day = getClinicDateString(start)
                  props.onCreate(day, minutesOnDay(start.toISOString(), day), column?.resourceKey ?? null)
                }
              : undefined
          }
          canMoveItem={(item) => canWrite && canDrag(item.appointment)}
          canResizeItem={() => false}
          // The time moves; the professional stays hers (a drop in another one's column moves the time only).
          onMoveItem={(item, next) => props.onMove(item.appointment, next.start.toISOString())}
          columnMinWidth={phone ? 176 : xl ? 128 : 96}
          height="content"
        />
      </CalendarGridProvider>
    </div>
  )
}

/** Only a booked or confirmed appointment moves; never a personal one (R2). */
const canDrag = (a: AgendaAppointment) => !a.isPersonal && (a.state === 'booked' || a.state === 'confirmed')

/** The hours down the grid's left side. */
export function HourRail({ range = DEFAULT_GRID }: { range?: GridRange }) {
  const height = ((range.end - range.start) / 60) * HOUR_HEIGHT
  return (
    <div className="w-14 shrink-0 border-r border-border" aria-hidden>
      <div className="h-12 border-b border-border" />
      <div className="relative" style={{ height }}>
        {hoursOf(range).map((m) => (
          <div key={m} className="absolute right-1.5 -translate-y-1/2 text-xs text-muted-foreground tabular" style={{ top: ((m - range.start) / 60) * HOUR_HEIGHT }}>
            {m === range.start ? '' : hhmm(m)}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A column's header: the day (or the professional) and its sublabel. */
export function ColumnHeader({ column }: { column: GridColumn }) {
  return (
    <div className="flex h-12 flex-col justify-center border-b border-border px-2 text-center">
      <span className="truncate text-sm font-medium">{column.label}</span>
      {column.sublabel && <span className="truncate text-xs text-muted-foreground">{column.sublabel}</span>}
    </div>
  )
}

/** The hour lines of a column. */
export function HourLines({ range = DEFAULT_GRID }: { range?: GridRange }) {
  return hoursOf(range).map((m) => (
    <div key={m} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: ((m - range.start) / 60) * HOUR_HEIGHT }} />
  ))
}
