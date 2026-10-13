import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Ban, Phone, Repeat, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import type { AgendaAppointment, AvailabilityException, AvailabilityRule } from '../api/parse'
import { exceptionsOn, placeAppointments, verticalBox, windowsOn } from '../lib/layout'
import { DEFAULT_GRID, SNAP, gridRangeFor, hhmm, instantOf, minutesOnDay, snap, type GridRange } from '../lib/time'
import { appointmentTitle, blockClasses, isBusyOnly, stateLabel } from '../lib/display'

/** Pixels per hour of the grid (16 hours by default: 6:00 to 22:00). */
export const HOUR_HEIGHT = 48
const hoursOf = (range: GridRange) => Array.from({ length: (range.end - range.start) / 60 }, (_, i) => range.start + i * 60)
const A = 'modules.appointments.agenda'

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
}

interface Drag {
  id: string
  originY: number
  offset: number
  moved: boolean
}

/**
 * The agenda's time grid (plan R2): columns of days or professionals, 6:00–22:00, widened by whole
 * hours to any appointment outside it (one is never hidden), each item placed by its clinic date and clock time (`lib/time`, so 9:00 stays on the 9:00 line across a
 * daylight-saving change). Booking mode: availability windows shaded and exceptions hatched; a
 * click on an empty quarter hour creates an appointment there; an appointment opens on click and
 * moves by dragging (Pointer Events, 15-minute snapping), the move confirmed by the database.
 * « Disponibilités » is `AvailabilityGrid` (direct manipulation, AP-27). Blocks are buttons (keyboard: Tab then Entrée); creation also has the toolbar's button.
 */
export function TimeGrid(props: TimeGridProps) {
  const { columns } = props
  const range = gridRangeFor(columns.flatMap((column) => placeAppointments(ownOf(props.appointments, column), column.day)))
  const height = ((range.end - range.start) / 60) * HOUR_HEIGHT
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <div className="flex min-w-max">
        <HourRail range={range} />
        {columns.map((column) => (
          <Column key={column.key} column={column} height={height} range={range} {...props} />
        ))}
      </div>
    </div>
  )
}

/** A column's appointments: all of them in a week of several professionals, else its professional's. */
const ownOf = (appointments: readonly AgendaAppointment[], column: GridColumn) =>
  appointments.filter((a) => column.professionalId === null || a.professionalId === column.professionalId)

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

function Column({ column, height, range, ...props }: TimeGridProps & { column: GridColumn; height: number; range: GridRange }) {
  const { appointments, rules, exceptions, canWrite } = props
  const shadeFor = column.professionalId ?? props.shadeProfessionalId
  const placed = placeAppointments(ownOf(appointments, column), column.day)
  const windows = shadeFor ? windowsOn(rules, shadeFor, column.day) : []
  const offs = shadeFor ? exceptionsOn(exceptions, shadeFor, column.day) : []
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  // A drag ends with a click on the block: that click must not open it.
  const justDragged = useRef(false)

  const minutesAt = (event: { clientY: number; currentTarget: HTMLElement }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.floor(((event.clientY - rect.top) / HOUR_HEIGHT) * 60 / SNAP) * SNAP + range.start
  }

  const onBackground = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canWrite || event.target !== event.currentTarget) return
    props.onCreate(column.day, minutesAt(event), column.professionalId)
  }

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, a: AgendaAppointment) => {
    if (!canWrite || a.isPersonal || (a.state !== 'booked' && a.state !== 'confirmed')) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { id: a.id, originY: event.clientY, offset: 0, moved: false }
    setDrag(dragRef.current)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>, a: AgendaAppointment) => {
    const d = dragRef.current
    if (!d) return
    // Kept on the grid: its first hour at the earliest, its end at the last hour at the latest.
    const start = minutesOnDay(a.startsAt, column.day)
    const length = minutesOnDay(a.endsAt, column.day) - start
    const offset = Math.min(Math.max(snap(((event.clientY - d.originY) / HOUR_HEIGHT) * 60), range.start - start), range.end - length - start)
    if (offset === d.offset) return
    dragRef.current = { ...d, offset, moved: d.moved || offset !== 0 }
    setDrag(dragRef.current)
  }
  const endDrag = (a: AgendaAppointment) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (d && d.moved) {
      justDragged.current = true
      if (d.offset !== 0) props.onMove(a, instantOf(column.day, minutesOnDay(a.startsAt, column.day) + d.offset))
    }
  }

  return (
    <div className="w-44 shrink-0 border-r border-border last:border-r-0 sm:w-auto sm:min-w-40 sm:flex-1">
      <ColumnHeader column={column} />
      <div
        className={cn('relative', canWrite && 'cursor-copy')}
        style={{ height }}
        onClick={onBackground}
        data-testid={`agenda-column-${column.key}`}
      >
        <HourLines range={range} />
        {windows.map(({ rule, start, end }) => (
          <div key={rule.id} aria-hidden className="pointer-events-none absolute inset-x-0 bg-primary/5" style={verticalBox(start, end, HOUR_HEIGHT, range)} />
        ))}
        {offs.map(({ exception, start, end }) => (
          <div
            key={exception.id}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-muted [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(var(--border-strong))_6px_7px)]"
            style={verticalBox(start, end, HOUR_HEIGHT, range)}
          />
        ))}
        {placed.map(({ item: a, start, end, lane, lanes }) => {
            const offset = drag?.id === a.id ? drag.offset : 0
            const box = verticalBox(start + offset, end + offset, HOUR_HEIGHT, range)
            const width = 100 / lanes
            const colour = props.serviceColour?.(a.serviceId) ?? null
            const position = {
              top: box.top,
              height: Math.max(box.height, 18),
              left: `calc(${lane * width}% + 2px)`,
              width: `calc(${width}% - 4px)`,
              // The service's colour on the left edge (AP-33); the state keeps the block's own tone.
              ...(colour && { borderLeftColor: colour, borderLeftWidth: 4 }),
            }
            // Another professional's personal appointment: busy time, nothing to open (AP-13).
            if (isBusyOnly(a)) {
              return (
                <div key={a.id} className={cn('absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-xs', blockClasses(a))} style={position}>
                  {appointmentTitle(a)}
                </div>
              )
            }
            return (
              <button
                key={a.id}
                type="button"
                onPointerDown={(event) => startDrag(event, a)}
                onPointerMove={(event) => moveDrag(event, a)}
                onPointerUp={() => endDrag(a)}
                onPointerCancel={() => {
                  dragRef.current = null
                  setDrag(null)
                }}
                onClick={() => {
                  if (justDragged.current) {
                    justDragged.current = false
                    return
                  }
                  props.onOpen(a)
                }}
                className={cn(
                  'absolute touch-none overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-xs shadow-sm',
                  blockClasses(a),
                  drag?.id === a.id && 'z-10 opacity-80 ring-2 ring-primary',
                )}
                style={position}
                aria-label={t(`${A}.blockLabel`, { time: formatClinicTime(a.startsAt), title: appointmentTitle(a) })}
              >
                <span className="flex items-center gap-1 font-medium">
                  <span className="tabular">{offset ? hhmm(start + offset) : formatClinicTime(a.startsAt)}</span>
                  {a.mode === 'phone' && <Phone aria-hidden className="size-3" />}
                  {a.outsideAvailability && <TriangleAlert aria-hidden className="size-3 text-warning" />}
                  {a.state === 'cancelled' && <Ban aria-hidden className="size-3" />}
                  {a.seriesId && <Repeat aria-hidden className="size-3" />}
                </span>
                <span className="block truncate">{appointmentTitle(a)}</span>
                {a.state === 'held' && <span className="block truncate text-muted-foreground">{stateLabel(a.state)}</span>}
                {props.showProfessional && <span className="block truncate text-muted-foreground">{props.professionalName(a.professionalId)}</span>}
              </button>
            )
          })}
      </div>
    </div>
  )
}
