import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Ban, Phone, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import type { AgendaAppointment, AvailabilityException, AvailabilityRule } from '../api/parse'
import { exceptionsOn, placeAppointments, verticalBox, windowsOn } from '../lib/layout'
import { GRID_END, GRID_START, SNAP, hhmm, instantOf, minutesOnDay, snap } from '../lib/time'
import { appointmentTitle, blockClasses, isBusyOnly } from '../lib/display'

/** Pixels per hour of the grid (14 hours: 7:00 to 21:00). */
export const HOUR_HEIGHT = 48
const HOURS = Array.from({ length: (GRID_END - GRID_START) / 60 }, (_, i) => GRID_START + i * 60)
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
  /** `booking`: availability shaded, appointments to open, drag and create; `availability`: windows to edit. */
  mode: 'booking' | 'availability'
  /** The professional whose availability is shaded when a column has none of its own. */
  shadeProfessionalId: string | null
  professionalName: (id: string) => string
  showProfessional: boolean
  canWrite: boolean
  onCreate: (day: string, minutes: number, professionalId: string | null) => void
  onOpen: (appointment: AgendaAppointment) => void
  onMove: (appointment: AgendaAppointment, startsAt: string) => void
  onRule: (rule: AvailabilityRule) => void
}

interface Drag {
  id: string
  originY: number
  offset: number
  moved: boolean
}

/**
 * The agenda's time grid (plan R2): columns of days or professionals, 7:00–21:00, each item
 * placed by its clinic date and clock time (`lib/time`, so 9:00 stays on the 9:00 line across a
 * daylight-saving change). Booking mode: availability windows shaded and exceptions hatched; a
 * click on an empty quarter hour creates an appointment there; an appointment opens on click and
 * moves by dragging (Pointer Events, 15-minute snapping), the move confirmed by the database.
 * Availability mode: the windows are buttons that open their editor; a click elsewhere adds one.
 * Blocks are buttons (keyboard: Tab then Entrée); creation also has the toolbar's button.
 */
export function TimeGrid(props: TimeGridProps) {
  const { columns, mode } = props
  const height = ((GRID_END - GRID_START) / 60) * HOUR_HEIGHT
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <div className="flex min-w-max">
        <div className="w-14 shrink-0 border-r border-border" aria-hidden>
          <div className="h-12 border-b border-border" />
          <div className="relative" style={{ height }}>
            {HOURS.map((m) => (
              <div key={m} className="absolute right-1.5 -translate-y-1/2 text-xs text-muted-foreground tabular" style={{ top: ((m - GRID_START) / 60) * HOUR_HEIGHT }}>
                {m === GRID_START ? '' : hhmm(m)}
              </div>
            ))}
          </div>
        </div>
        {columns.map((column) => (
          <Column key={column.key} column={column} height={height} {...props} mode={mode} />
        ))}
      </div>
    </div>
  )
}

function Column({ column, height, ...props }: TimeGridProps & { column: GridColumn; height: number }) {
  const { appointments, rules, exceptions, mode, canWrite } = props
  const shadeFor = column.professionalId ?? props.shadeProfessionalId
  const own = appointments.filter((a) => (column.professionalId === null || a.professionalId === column.professionalId))
  const placed = placeAppointments(own, column.day)
  const windows = shadeFor ? windowsOn(rules, shadeFor, column.day) : []
  const offs = shadeFor ? exceptionsOn(exceptions, shadeFor, column.day) : []
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  // A drag ends with a click on the block: that click must not open it.
  const justDragged = useRef(false)

  const minutesAt = (event: { clientY: number; currentTarget: HTMLElement }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.floor(((event.clientY - rect.top) / HOUR_HEIGHT) * 60 / SNAP) * SNAP + GRID_START
  }

  const onBackground = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canWrite || event.target !== event.currentTarget) return
    props.onCreate(column.day, minutesAt(event), column.professionalId)
  }

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, a: AgendaAppointment) => {
    if (!canWrite || mode !== 'booking' || a.isPersonal || (a.state !== 'booked' && a.state !== 'confirmed')) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { id: a.id, originY: event.clientY, offset: 0, moved: false }
    setDrag(dragRef.current)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>, a: AgendaAppointment) => {
    const d = dragRef.current
    if (!d) return
    // Kept on the grid: 7:00 at the earliest, its end at 21:00 at the latest.
    const start = minutesOnDay(a.startsAt, column.day)
    const length = minutesOnDay(a.endsAt, column.day) - start
    const offset = Math.min(Math.max(snap(((event.clientY - d.originY) / HOUR_HEIGHT) * 60), GRID_START - start), GRID_END - length - start)
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
      <div className="flex h-12 flex-col justify-center border-b border-border px-2 text-center">
        <span className="truncate text-sm font-medium">{column.label}</span>
        {column.sublabel && <span className="truncate text-xs text-muted-foreground">{column.sublabel}</span>}
      </div>
      <div
        className={cn('relative', canWrite && 'cursor-copy')}
        style={{ height }}
        onClick={onBackground}
        data-testid={`agenda-column-${column.key}`}
      >
        {HOURS.map((m) => (
          <div key={m} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: ((m - GRID_START) / 60) * HOUR_HEIGHT }} />
        ))}
        {windows.map(({ rule, start, end }) => {
          const box = verticalBox(start, end, HOUR_HEIGHT)
          return mode === 'availability' ? (
            <button
              key={rule.id}
              type="button"
              onClick={() => props.onRule(rule)}
              className="absolute inset-x-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-1 text-left text-xs"
              style={box}
              aria-label={t(`${A}.windowLabel`, { start: rule.startTime, end: rule.endTime })}
            >
              <span className="tabular">
                {rule.startTime} – {rule.endTime}
              </span>
              {rule.serviceIds.length > 0 && <span className="block text-muted-foreground">{t(`${A}.windowServices`, { count: String(rule.serviceIds.length) })}</span>}
            </button>
          ) : (
            <div key={rule.id} aria-hidden className="pointer-events-none absolute inset-x-0 bg-primary/5" style={box} />
          )
        })}
        {offs.map(({ exception, start, end }) => (
          <div
            key={exception.id}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-muted [background-image:repeating-linear-gradient(135deg,transparent_0_6px,var(--border)_6px_7px)]"
            style={verticalBox(start, end, HOUR_HEIGHT)}
          />
        ))}
        {mode === 'booking' &&
          placed.map(({ item: a, start, end, lane, lanes }) => {
            const offset = drag?.id === a.id ? drag.offset : 0
            const box = verticalBox(start + offset, end + offset, HOUR_HEIGHT)
            const width = 100 / lanes
            const position = { top: box.top, height: Math.max(box.height, 18), left: `calc(${lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }
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
                </span>
                <span className="block truncate">{appointmentTitle(a)}</span>
                {props.showProfessional && <span className="block truncate text-muted-foreground">{props.professionalName(a.professionalId)}</span>}
              </button>
            )
          })}
      </div>
    </div>
  )
}
