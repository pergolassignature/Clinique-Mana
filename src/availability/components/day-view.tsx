// src/availability/components/day-view.tsx

import { useMemo } from 'react'
import { format, isToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment } from '../types'
import { AppointmentBlock } from './appointment-block'
import { NowLine } from './now-line'
import { MOCK_SERVICES, MOCK_CLIENTS } from '../mock'

interface DayViewProps {
  date: Date
  appointments: Appointment[]
  onSlotClick: (date: Date, time: string) => void
  onAppointmentClick: (appointment: Appointment) => void
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
const SLOT_HEIGHT = 48 // Slightly taller than week view for better readability

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`)
    slots.push(`${hour.toString().padStart(2, '0')}:30`)
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()

export function DayView({
  date,
  appointments,
  onSlotClick,
  onAppointmentClick,
  onCreateDragStart,
  onAppointmentDragStart,
  onAppointmentResizeStart,
  onPointerMove,
  onPointerUp,
  createPreview,
  isDragging = false,
}: DayViewProps) {
  // Filter appointments for the given date only
  const dayAppointments = useMemo(() => {
    const dateKey = format(date, 'yyyy-MM-dd')
    return appointments.filter(apt => {
      const aptDate = new Date(apt.startTime)
      return format(aptDate, 'yyyy-MM-dd') === dateKey
    })
  }, [appointments, date])

  // Calculate position for an appointment
  const getAppointmentPosition = (apt: Appointment) => {
    const startDate = new Date(apt.startTime)
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes() - START_HOUR * 60
    const top = (startMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    const height = (apt.durationMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    return { top, height }
  }

  // Get service and clients for an appointment
  const getAppointmentDetails = (apt: Appointment) => {
    const service = MOCK_SERVICES.find(s => s.id === apt.serviceId)
    const clients = apt.clientIds.map(id => MOCK_CLIENTS.find(c => c.id === id))
    return { service, clients }
  }

  const isTodayDate = isToday(date)

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      {/* Day header */}
      <div className="grid grid-cols-[64px_1fr] border-b border-border bg-background-secondary/50 sticky top-0 z-10">
        {/* Empty corner cell */}
        <div className="border-r border-border" />

        <div
          className={cn(
            'px-4 py-3 text-center',
            isTodayDate && 'bg-sage-50/50'
          )}
        >
          <div className="text-xs font-medium text-foreground-muted uppercase">
            {format(date, 'EEEE', { locale: fr })}
          </div>
          <div
            className={cn(
              'text-lg font-semibold mt-0.5',
              isTodayDate ? 'text-sage-700' : 'text-foreground'
            )}
          >
            {format(date, 'd MMMM', { locale: fr })}
          </div>
        </div>
      </div>

      {/* Time grid */}
      <div
        className="grid grid-cols-[64px_1fr] overflow-y-auto max-h-[calc(100vh-300px)]"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Time labels column */}
        <div className="border-r border-border/60">
          {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
            <div
              key={i}
              className="flex items-center justify-end pr-2 box-border border-b border-border/60"
              style={{ height: SLOT_HEIGHT * 2 }}
            >
              <span className="text-[11px] font-medium text-foreground-muted">
                {(START_HOUR + i).toString().padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Day column */}
        <div
          className={cn(
            'relative',
            isTodayDate && 'bg-sage-50/20'
          )}
          onPointerDown={(e) => {
            // Only start drag if clicking directly on the column (not on an appointment)
            if (!onCreateDragStart) return
            const target = e.target as HTMLElement
            if (e.target === e.currentTarget.querySelector('[data-slot-area]') ||
                target.hasAttribute('data-slot')) {
              onCreateDragStart(e, 0)
            }
          }}
        >
          {/* Slot lines */}
          {TIME_SLOTS.map((time, index) => {
            const isHourBoundary = index % 2 === 1
            return (
              <div
                key={time}
                data-slot
                onClick={() => onSlotClick(date, time)}
                onPointerDown={(e) => {
                  if (onCreateDragStart) {
                    onCreateDragStart(e, 0)
                  }
                }}
                className={cn(
                  'relative border-b cursor-pointer transition-colors hover:bg-sage-50/50',
                  isHourBoundary ? 'border-border/60' : 'border-transparent'
                )}
                style={{ height: SLOT_HEIGHT }}
              />
            )
          })}

          {/* Now line */}
          <NowLine
            dayDate={date}
            startHour={START_HOUR}
            slotHeight={SLOT_HEIGHT}
            intervalMinutes={INTERVAL_MINUTES}
          />

          {/* Create preview rectangle */}
          {createPreview && createPreview.dayIndex === 0 && (
            <div
              className="absolute left-1 right-1 bg-sage-200/50 border-2 border-dashed border-sage-400 rounded-lg pointer-events-none z-10"
              style={{
                top: `${createPreview.top}px`,
                height: `${createPreview.height}px`,
              }}
            />
          )}

          {/* Appointments overlay */}
          <div className="absolute inset-x-2 top-0 pointer-events-none">
            {dayAppointments.map((apt) => {
              const { top, height } = getAppointmentPosition(apt)
              const { service, clients } = getAppointmentDetails(apt)

              return (
                <div
                  key={apt.id}
                  className="absolute left-0 right-0 pointer-events-auto"
                  style={{ top: `${top}px`, height: `${height}px` }}
                >
                  <AppointmentBlock
                    appointment={apt}
                    service={service}
                    clients={clients}
                    onClick={() => onAppointmentClick(apt)}
                    onDragStart={
                      onAppointmentDragStart
                        ? (e) => onAppointmentDragStart(e, apt.id, 0)
                        : undefined
                    }
                    onResizeStart={
                      onAppointmentResizeStart
                        ? (e, edge) => onAppointmentResizeStart(e, apt.id, 0, edge)
                        : undefined
                    }
                    isDragging={isDragging}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
