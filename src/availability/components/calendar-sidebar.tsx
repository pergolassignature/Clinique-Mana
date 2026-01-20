// src/availability/components/calendar-sidebar.tsx

import { useMemo } from 'react'
import { format, isToday, isTomorrow, startOfDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment, CalendarViewMode } from '../types'
import { MOCK_SERVICES, MOCK_CLIENTS } from '../mock'

interface CalendarSidebarProps {
  appointments: Appointment[]
  viewDate: Date
  viewMode: CalendarViewMode
  onViewModeChange: (mode: CalendarViewMode) => void
  onAppointmentClick: (appointment: Appointment) => void
}

function getDateLabel(date: Date): string {
  if (isToday(date)) return "Aujourd'hui"
  if (isTomorrow(date)) return 'Demain'
  return format(date, 'EEEE d MMMM', { locale: fr })
}

export function CalendarSidebar({
  appointments,
  viewMode,
  onViewModeChange,
  onAppointmentClick,
}: CalendarSidebarProps) {
  // Get upcoming appointments (today + next 7 days)
  const upcomingAppointments = useMemo(() => {
    const today = startOfDay(new Date())
    return appointments
      .filter(apt => {
        const aptDate = new Date(apt.startTime)
        return aptDate >= today && apt.status === 'confirmed'
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 10)
  }, [appointments])

  // Group by day
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>()
    upcomingAppointments.forEach(apt => {
      const dayKey = format(new Date(apt.startTime), 'yyyy-MM-dd')
      if (!groups.has(dayKey)) groups.set(dayKey, [])
      groups.get(dayKey)!.push(apt)
    })
    return groups
  }, [upcomingAppointments])

  const getService = (id: string) => MOCK_SERVICES.find(s => s.id === id)
  const getClient = (id: string | undefined) => id ? MOCK_CLIENTS.find(c => c.id === id) : undefined

  return (
    <aside className="w-72 border-r border-border bg-background-secondary/30 flex flex-col h-full">
      {/* View mode toggle */}
      <div className="p-4 border-b border-border">
        <div className="flex rounded-lg bg-background-tertiary/50 p-1">
          {(['day', 'week', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={cn(
                'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                viewMode === mode
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-foreground-muted hover:text-foreground'
              )}
            >
              {mode === 'day' && 'Jour'}
              {mode === 'week' && 'Semaine'}
              {mode === 'list' && 'Liste'}
            </button>
          ))}
        </div>
      </div>

      {/* Agenda list */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          A venir
        </h3>

        {upcomingAppointments.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun rendez-vous a venir</p>
        ) : (
          <div className="space-y-4">
            {Array.from(groupedByDay.entries()).map(([dayKey, dayApts]) => (
              <div key={dayKey}>
                <div className="text-xs font-medium text-foreground-secondary mb-2">
                  {getDateLabel(new Date(dayKey + 'T00:00:00'))}
                </div>
                <div className="space-y-1.5">
                  {dayApts.map(apt => {
                    const service = getService(apt.serviceId)
                    const client = getClient(apt.clientIds[0])
                    return (
                      <button
                        key={apt.id}
                        onClick={() => onAppointmentClick(apt)}
                        className="w-full text-left p-2 rounded-lg hover:bg-background-tertiary/50 transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-1 h-8 rounded-full"
                            style={{ backgroundColor: service?.colorHex || '#888' }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">
                              {client ? `${client.firstName} ${client.lastName}` : 'Client'}
                            </div>
                            <div className="text-xs text-foreground-muted">
                              {format(new Date(apt.startTime), 'HH:mm')} · {service?.nameFr}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats footer */}
      <div className="p-4 border-t border-border bg-background-tertiary/30">
        <div className="text-xs text-foreground-muted">
          {upcomingAppointments.length} rendez-vous a venir
        </div>
      </div>
    </aside>
  )
}
