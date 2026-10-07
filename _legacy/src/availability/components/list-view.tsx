// src/availability/components/list-view.tsx

import { useMemo } from 'react'
import { startOfWeek, endOfWeek, isToday } from 'date-fns'
import { Clock, FileText } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import {
  formatInClinicTimezone,
  toClinicTime,
  getClinicDateString,
} from '@/shared/lib/timezone'
import type { Appointment, BookableService, Client } from '../types'

interface ListViewProps {
  viewDate: Date
  appointments: Appointment[]
  onAppointmentClick: (appointment: Appointment) => void
  /** Real data from database */
  bookableServices: BookableService[]
  clients: Client[]
}

export function ListView({ viewDate, appointments, onAppointmentClick, bookableServices, clients }: ListViewProps) {
  // Get week range
  const weekStart = startOfWeek(viewDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(viewDate, { weekStartsOn: 1 })

  // Filter and group appointments by day using clinic timezone
  const groupedAppointments = useMemo(() => {
    const filtered = appointments
      .filter(apt => {
        const aptDate = toClinicTime(apt.startTime)
        return aptDate >= weekStart && aptDate <= weekEnd
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

    const groups = new Map<string, Appointment[]>()
    filtered.forEach(apt => {
      const dayKey = getClinicDateString(apt.startTime)
      if (!groups.has(dayKey)) groups.set(dayKey, [])
      groups.get(dayKey)!.push(apt)
    })

    return groups
  }, [appointments, weekStart, weekEnd])

  const getService = (id: string) => bookableServices.find(s => s.id === id)
  const getClient = (id: string | undefined) => id ? clients.find(c => c.id === id) : undefined

  if (groupedAppointments.size === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-foreground-muted">
        Aucun rendez-vous cette semaine
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {Array.from(groupedAppointments.entries()).map(([dayKey, dayApts]) => {
        // Use dayKey to create date (format: yyyy-MM-dd)
        const dayDate = new Date(dayKey + 'T00:00:00')
        const today = isToday(dayDate)

        return (
          <div key={dayKey}>
            {/* Day header */}
            <div className={cn(
              'flex items-center gap-3 mb-3 pb-2 border-b border-border',
              today && 'border-sage-300'
            )}>
              <div className={cn(
                'w-12 h-12 rounded-xl flex flex-col items-center justify-center',
                today ? 'bg-sage-100 text-sage-700' : 'bg-background-secondary text-foreground'
              )}>
                <span className="text-xs font-medium uppercase">
                  {formatInClinicTimezone(dayDate, 'EEE')}
                </span>
                <span className="text-lg font-semibold">
                  {formatInClinicTimezone(dayDate, 'd')}
                </span>
              </div>
              <div>
                <div className={cn(
                  'text-sm font-medium',
                  today ? 'text-sage-700' : 'text-foreground'
                )}>
                  {today ? "Aujourd'hui" : formatInClinicTimezone(dayDate, 'EEEE')}
                </div>
                <div className="text-xs text-foreground-muted">
                  {dayApts.length} rendez-vous
                </div>
              </div>
            </div>

            {/* Appointments list */}
            <div className="space-y-2 ml-2">
              {dayApts.map(apt => {
                const service = getService(apt.serviceId)
                const client = getClient(apt.clientIds[0])
                const startTime = new Date(apt.startTime)
                const endTime = new Date(startTime.getTime() + apt.durationMinutes * 60000)
                const isCancelled = apt.status === 'cancelled'

                return (
                  <button
                    key={apt.id}
                    onClick={() => onAppointmentClick(apt)}
                    className={cn(
                      'w-full text-left p-4 rounded-xl border transition-all',
                      'hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sage-400',
                      isCancelled
                        ? 'bg-background-tertiary/50 border-border-light opacity-60'
                        : 'bg-background border-border hover:border-sage-300'
                    )}
                  >
                    <div className="flex items-start gap-4">
                      {/* Service color indicator */}
                      <div
                        className="w-1 h-14 rounded-full flex-shrink-0"
                        style={{ backgroundColor: isCancelled ? '#888' : service?.colorHex }}
                      />

                      <div className="flex-1 min-w-0">
                        {/* Client name */}
                        <div className={cn(
                          'text-base font-medium',
                          isCancelled ? 'line-through text-foreground-muted' : 'text-foreground'
                        )}>
                          {client ? `${client.firstName} ${client.lastName}` : 'Client'}
                        </div>

                        {/* Service */}
                        <div className="flex items-center gap-1.5 text-sm text-foreground-secondary mt-1">
                          <FileText className="h-3.5 w-3.5" />
                          {service?.nameFr || 'Service'}
                        </div>

                        {/* Time */}
                        <div className="flex items-center gap-1.5 text-sm text-foreground-muted mt-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatInClinicTimezone(startTime, 'HH:mm')} – {formatInClinicTimezone(endTime, 'HH:mm')}
                          <span className="text-xs">({apt.durationMinutes} min)</span>
                        </div>
                      </div>

                      {/* Status badge */}
                      {isCancelled && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-wine-100 text-wine-700">
                          Annule
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
