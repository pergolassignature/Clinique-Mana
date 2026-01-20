// src/availability/components/calendar-grid.tsx

import { useMemo } from 'react'
import { format, addDays, isToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment } from '../types'
import { AppointmentBlock } from './appointment-block'
import { NowLine } from './now-line'
import { MOCK_SERVICES, MOCK_CLIENTS } from '../mock'

interface CalendarGridProps {
  weekStartDate: Date
  appointments: Appointment[]
  onSlotClick: (date: Date, time: string) => void
  onAppointmentClick: (appointment: Appointment) => void
  // Drag interaction props
  onCreateDragStart?: (e: React.PointerEvent, dayIndex: number) => void
  onAppointmentDragStart?: (e: React.PointerEvent, appointmentId: string, dayIndex: number) => void
  onAppointmentResizeStart?: (e: React.PointerEvent, appointmentId: string, dayIndex: number, edge: 'top' | 'bottom') => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  createPreview?: { top: number; height: number; dayIndex: number } | null
  isDragging?: boolean
}

// Time range: 06:00 to 22:00 in 30-minute intervals
const START_HOUR = 6
const END_HOUR = 22
const INTERVAL_MINUTES = 30

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`)
    slots.push(`${hour.toString().padStart(2, '0')}:30`)
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()
const SLOT_HEIGHT = 40 // pixels per 30-min slot

export function CalendarGrid({
  weekStartDate,
  appointments,
  onSlotClick,
  onAppointmentClick,
  onCreateDragStart,
  onAppointmentDragStart,
  onAppointmentResizeStart,
  onPointerMove,
  onPointerUp,
  createPreview,
  isDragging,
}: CalendarGridProps) {
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

  // Calculate position for an appointment
  const getAppointmentPosition = (apt: Appointment) => {
    const startDate = new Date(apt.startTime)
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes() - START_HOUR * 60
    const top = (startMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    const height = (apt.durationMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    return { top, height }
  }

  // Get service and client for an appointment
  const getAppointmentDetails = (apt: Appointment) => {
    const service = MOCK_SERVICES.find(s => s.id === apt.serviceId)
    const client = MOCK_CLIENTS.find(c => c.id === apt.clientId)
    return { service, client }
  }

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      {/* Days header */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-background-secondary/50 sticky top-0 z-10">
        {/* Empty corner cell */}
        <div className="border-r border-border" />

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
      <div
        className="grid grid-cols-[60px_repeat(7,1fr)] overflow-y-auto max-h-[calc(100vh-300px)]"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Time labels column */}
        <div className="border-r border-border">
          {TIME_SLOTS.map((time, index) => (
            <div
              key={time}
              className="h-10 flex items-start justify-end pr-2 -mt-2"
              style={{ height: SLOT_HEIGHT }}
            >
              {index % 2 === 0 && (
                <span className="text-xs text-foreground-muted">
                  {time}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day, dayIndex) => {
          const dayKey = format(day, 'yyyy-MM-dd')
          const dayAppointments = appointmentsByDay.get(dayKey) || []

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'relative border-r border-border last:border-r-0',
                isToday(day) && 'bg-sage-50/30'
              )}
              onPointerDown={(e) => onCreateDragStart?.(e, dayIndex)}
            >
              {/* Slot lines */}
              {TIME_SLOTS.map((time, index) => (
                <div
                  key={time}
                  onClick={() => onSlotClick(day, time)}
                  className={cn(
                    'h-10 border-b border-border-light cursor-pointer transition-colors hover:bg-sage-50/50',
                    index % 2 === 0 && 'border-b-border'
                  )}
                  style={{ height: SLOT_HEIGHT }}
                />
              ))}

              {/* Now line indicator */}
              <NowLine
                dayDate={day}
                startHour={START_HOUR}
                slotHeight={SLOT_HEIGHT}
                intervalMinutes={INTERVAL_MINUTES}
              />

              {/* Create preview rectangle */}
              {createPreview && createPreview.dayIndex === dayIndex && (
                <div
                  className="absolute left-1 right-1 rounded-lg bg-sage-200/50 border-2 border-dashed border-sage-400 pointer-events-none z-10"
                  style={{ top: createPreview.top, height: Math.max(createPreview.height, SLOT_HEIGHT) }}
                />
              )}

              {/* Appointments overlay */}
              <div className="absolute inset-x-1 top-0 pointer-events-none">
                {dayAppointments.map((apt) => {
                  const { top, height } = getAppointmentPosition(apt)
                  const { service, client } = getAppointmentDetails(apt)

                  return (
                    <div
                      key={apt.id}
                      className="absolute left-0 right-0 pointer-events-auto"
                      style={{ top: `${top}px`, height: `${height}px` }}
                    >
                      <AppointmentBlock
                        appointment={apt}
                        service={service}
                        client={client}
                        onClick={() => onAppointmentClick(apt)}
                        onDragStart={(e) => onAppointmentDragStart?.(e, apt.id, dayIndex)}
                        onResizeStart={(e, edge) => onAppointmentResizeStart?.(e, apt.id, dayIndex, edge)}
                        isDragging={isDragging}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
