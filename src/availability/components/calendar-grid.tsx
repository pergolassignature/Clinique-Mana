// src/availability/components/calendar-grid.tsx

import { useMemo, useState, useCallback, type PointerEvent } from 'react'
import { format, addDays, isToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment, AvailabilityBlock, CalendarMode } from '../types'
import type { DragPreview } from '../hooks/use-calendar-dnd'
import { DroppableDayColumn } from '../dnd/droppable-day-column'
import { DraggableCreateSlot } from '../dnd/draggable-create-slot'
import { DraggableAvailability } from '../dnd/draggable-availability'
import { DraggableAppointment } from '../dnd/draggable-appointment'
import { NowLine } from './now-line'
import { MOCK_BOOKABLE_SERVICES, MOCK_CLIENTS } from '../mock'
import { minutesToPixel, DEFAULT_CONFIG, getMinutesFromPointer } from '../utils/time-grid'

interface CalendarGridProps {
  weekStartDate: Date
  appointments: Appointment[]
  availabilityBlocks: AvailabilityBlock[]
  calendarMode: CalendarMode
  onSlotClick: (date: Date, time: string) => void
  onAppointmentClick: (appointment: Appointment) => void
  onAvailabilityBlockClick?: (block: AvailabilityBlock) => void
  /** In booking mode, show availability overlay */
  showAvailabilityOverlay?: boolean
  /** Callback to register day column elements for position calculations */
  onDayColumnRegister?: (dayIndex: number, element: HTMLElement | null) => void
  /** Current drag preview from dnd system */
  dragPreview?: DragPreview | null
  /** Currently active draggable ID */
  activeDragId?: string | null
  /** Service drag highlighting - is a service being dragged from sidebar */
  isDraggingService?: boolean
  draggingServiceId?: string | null
}

const {
  startHour: START_HOUR,
  endHour: END_HOUR,
  intervalMinutes: INTERVAL_MINUTES,
  slotHeight: SLOT_HEIGHT,
} = DEFAULT_CONFIG

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let minutes = START_HOUR * 60; minutes < END_HOUR * 60; minutes += INTERVAL_MINUTES) {
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`)
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()
const HOUR_LABELS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) =>
  `${(START_HOUR + i).toString().padStart(2, '0')}:00`
)

export function CalendarGrid({
  weekStartDate,
  appointments,
  availabilityBlocks,
  calendarMode,
  onSlotClick,
  onAppointmentClick,
  onAvailabilityBlockClick,
  showAvailabilityOverlay = false,
  onDayColumnRegister,
  dragPreview,
  activeDragId,
  isDraggingService = false,
  draggingServiceId,
}: CalendarGridProps) {
  const [hoveredSlot, setHoveredSlot] = useState<{ dayIndex: number; minutes: number } | null>(null)

  // Generate 7 days starting from weekStartDate
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i))
  }, [weekStartDate])

  // Group appointments by day
  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>()

    days.forEach(day => {
      const dayKey = format(day, 'yyyy-MM-dd')
      map.set(dayKey, [])
    })

    appointments.forEach(apt => {
      const aptDate = new Date(apt.startTime)
      const dayKey = format(aptDate, 'yyyy-MM-dd')
      const existing = map.get(dayKey)
      if (existing) {
        existing.push(apt)
      }
    })

    return map
  }, [appointments, days])

  // Group availability blocks by day
  const availabilityBlocksByDay = useMemo(() => {
    const map = new Map<string, AvailabilityBlock[]>()

    days.forEach(day => {
      const dayKey = format(day, 'yyyy-MM-dd')
      map.set(dayKey, [])
    })

    availabilityBlocks.forEach(block => {
      const blockDate = new Date(block.startTime)
      const dayKey = format(blockDate, 'yyyy-MM-dd')
      const existing = map.get(dayKey)
      if (existing) {
        existing.push(block)
      }
    })

    return map
  }, [availabilityBlocks, days])

  // Calculate position for an appointment
  const getAppointmentPosition = (apt: Appointment) => {
    const startDate = new Date(apt.startTime)
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes()
    const top = minutesToPixel(startMinutes, DEFAULT_CONFIG)
    const height = minutesToPixel(startMinutes + apt.durationMinutes, DEFAULT_CONFIG) - top
    return { top, height }
  }

  // Calculate position for an availability block
  const getAvailabilityBlockPosition = (block: AvailabilityBlock) => {
    const startDate = new Date(block.startTime)
    const endDate = new Date(block.endTime)
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes()
    const endMinutes = endDate.getHours() * 60 + endDate.getMinutes()
    const top = minutesToPixel(startMinutes, DEFAULT_CONFIG)
    const height = minutesToPixel(endMinutes, DEFAULT_CONFIG) - top
    return { top, height }
  }

  // Get service and clients for an appointment
  const getAppointmentDetails = (apt: Appointment) => {
    const service = MOCK_BOOKABLE_SERVICES.find(s => s.id === apt.serviceId)
    const clients = apt.clientIds
      .map(id => MOCK_CLIENTS.find(c => c.id === id))
      .filter(Boolean)
    return { service, clients }
  }

  const shouldShowAvailability =
    calendarMode === 'availability' || showAvailabilityOverlay || isDraggingService
  const isLightOverlay =
    calendarMode === 'booking' && showAvailabilityOverlay && !isDraggingService
  const showHoverSlot = calendarMode === 'availability' && !dragPreview && !isDraggingService

  const handleCreatePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>, dayIndex: number) => {
      if (!showHoverSlot) return
      const rect = event.currentTarget.getBoundingClientRect()
      const minutes = getMinutesFromPointer(event.clientY, rect, DEFAULT_CONFIG)
      setHoveredSlot({ dayIndex, minutes })
    },
    [showHoverSlot]
  )

  const handleCreatePointerLeave = useCallback(() => {
    setHoveredSlot(null)
  }, [])

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div
        className="max-h-[calc(100vh-300px)] overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        {/* Days header */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-background-secondary/50 sticky top-0 z-20">
          {/* Empty corner cell */}
          <div className="border-r border-border bg-background-secondary/50" />

          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                'border-r border-border last:border-r-0 px-2 py-3 text-center',
                isToday(day) && 'bg-sage-50/50'
              )}
            >
              <div className="text-xs font-medium text-foreground-muted uppercase">
                {format(day, 'EEE', { locale: fr })}
              </div>
              <div
                className={cn(
                  'text-lg font-semibold mt-0.5',
                  isToday(day) ? 'text-sage-700' : 'text-foreground'
                )}
              >
                {format(day, 'd')}
              </div>
            </div>
          ))}
        </div>

        {/* Time grid */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)]">
          {/* Time labels column */}
          <div className="border-r border-border/60">
            {HOUR_LABELS.map((time) => (
              <div
                key={time}
                className="flex items-center justify-end pr-2 box-border border-b border-border/60"
                style={{ height: SLOT_HEIGHT * 2 }}
              >
                <span className="text-[11px] font-medium text-foreground-muted">
                  {time}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns - now using DroppableDayColumn */}
          {days.map((day, dayIndex) => {
            const dayKey = format(day, 'yyyy-MM-dd')
            const dayAppointments = appointmentsByDay.get(dayKey) || []
            const dayAvailabilityBlocks = availabilityBlocksByDay.get(dayKey) || []

            // Check if this day has the drag preview
            const showPreview = dragPreview && dragPreview.dayIndex === dayIndex

            return (
              <DroppableDayColumn
                key={day.toISOString()}
                dayIndex={dayIndex}
                onRegister={onDayColumnRegister}
              showDropHighlight={isDraggingService}
              className={cn(
                'border-r border-border/60 last:border-r-0',
                isToday(day) && 'bg-sage-50/30'
              )}
            >
                {/* Slot lines - for visual grid (no pointer events in availability mode) */}
                {TIME_SLOTS.map((time, index) => {
                  const isHourBoundary = index % 2 === 1
                  return (
                    <div
                      key={time}
                      onClick={calendarMode !== 'availability' ? () => onSlotClick(day, time) : undefined}
                      className={cn(
                        'relative box-border border-b transition-colors',
                        isHourBoundary ? 'border-border/60' : 'border-transparent',
                        calendarMode !== 'availability' && 'cursor-pointer hover:bg-sage-50/50'
                      )}
                      style={{ height: SLOT_HEIGHT }}
                    />
                  )
                })}

                {/* Create slot draggable - for drag-to-create in availability mode */}
                {calendarMode === 'availability' && (
                  <DraggableCreateSlot
                    dayIndex={dayIndex}
                    enabled
                    onPointerMove={(event) => handleCreatePointerMove(event, dayIndex)}
                    onPointerLeave={handleCreatePointerLeave}
                  >
                    {TIME_SLOTS.map((time) => (
                      <div
                        key={time}
                        onClick={() => onSlotClick(day, time)}
                        style={{ height: SLOT_HEIGHT }}
                        className="cursor-crosshair"
                      />
                    ))}
                  </DraggableCreateSlot>
                )}

                {showHoverSlot && hoveredSlot?.dayIndex === dayIndex && (
                  <div
                    className="absolute left-1 right-1 rounded-md border border-sage-300/70 bg-sage-100/30 pointer-events-none z-[6]"
                    style={{
                      top: minutesToPixel(hoveredSlot.minutes, DEFAULT_CONFIG),
                      height: SLOT_HEIGHT,
                    }}
                  />
                )}

                {/* Now line indicator */}
                <NowLine
                  dayDate={day}
                  startHour={START_HOUR}
                  slotHeight={SLOT_HEIGHT}
                  intervalMinutes={INTERVAL_MINUTES}
                />

              {/* Drag preview rectangle */}
              {showPreview && dragPreview && (
                <div
                  className="absolute left-1 right-1 rounded-lg bg-sage-200/50 border-2 border-dashed border-sage-400 pointer-events-none z-30"
                  style={{
                    top: minutesToPixel(dragPreview.startMinutes, DEFAULT_CONFIG),
                    height: minutesToPixel(dragPreview.endMinutes, DEFAULT_CONFIG) - minutesToPixel(dragPreview.startMinutes, DEFAULT_CONFIG),
                  }}
                />
              )}

              {showPreview && dragPreview && isDraggingService && (
                <div
                  className="absolute left-1 right-1 rounded-md border border-sage-400/70 bg-sage-100/60 pointer-events-none z-20"
                  style={{
                    top: minutesToPixel(dragPreview.startMinutes, DEFAULT_CONFIG),
                    height: SLOT_HEIGHT,
                  }}
                />
              )}

                {/* Availability blocks layer */}
                {shouldShowAvailability && (
                  <div className={cn(
                    'absolute inset-x-1 top-0',
                    calendarMode === 'availability' ? 'pointer-events-auto z-10' : 'pointer-events-none'
                  )}>
                    {dayAvailabilityBlocks.map((block) => {
                      const { top, height } = getAvailabilityBlockPosition(block)
                      // Check if this block can accept the dragging service
                      const canAcceptService = !!(
                        isDraggingService &&
                        block.type === 'available' &&
                        (
                          !block.allowedServiceIds ||
                          block.allowedServiceIds.length === 0 ||
                          (draggingServiceId && block.allowedServiceIds.includes(draggingServiceId))
                        )
                      )
                      // Check if this block is being dragged
                      const isBeingDragged = activeDragId === block.id ||
                        activeDragId === `${block.id}:resize-top` ||
                        activeDragId === `${block.id}:resize-bottom`

                      return (
                        <DraggableAvailability
                          key={block.id}
                          block={block}
                          dayIndex={dayIndex}
                          isAvailabilityMode={calendarMode === 'availability'}
                          onClick={() => onAvailabilityBlockClick?.(block)}
                          pixelTop={top}
                          pixelHeight={height}
                          isBeingDragged={isBeingDragged}
                          isHighlighted={canAcceptService}
                          isDimmed={isDraggingService && !canAcceptService}
                          overlayTone={isLightOverlay ? 'light' : 'none'}
                        />
                      )
                    })}
                  </div>
                )}

                {/* Appointments overlay - hidden in availability mode */}
                {calendarMode === 'booking' && (
                  <div className="absolute inset-x-1 top-0 pointer-events-auto z-10">
                    {dayAppointments.map((apt) => {
                      const { top, height } = getAppointmentPosition(apt)
                      const { service, clients } = getAppointmentDetails(apt)
                      // Check if this appointment is being dragged
                      const isBeingDragged = activeDragId === apt.id ||
                        activeDragId === `${apt.id}:resize-top` ||
                        activeDragId === `${apt.id}:resize-bottom`

                      return (
                        <DraggableAppointment
                          key={apt.id}
                          appointment={apt}
                          service={service}
                          clients={clients}
                          dayIndex={dayIndex}
                          onClick={() => onAppointmentClick(apt)}
                          pixelTop={top}
                          pixelHeight={height}
                          isBeingDragged={isBeingDragged}
                        />
                      )
                    })}
                  </div>
                )}
              </DroppableDayColumn>
            )
          })}
        </div>
      </div>
    </div>
  )
}
