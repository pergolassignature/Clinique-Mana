// src/availability/components/booking-sidebar.tsx

import { useMemo } from 'react'
import { format, isToday, isTomorrow, startOfDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment, Professional } from '../types'
import { ServiceDragItem } from './service-drag-item'
import { MOCK_BOOKABLE_SERVICES, MOCK_CLIENTS } from '../mock'

interface BookingSidebarProps {
  professional: Professional | null
  appointments: Appointment[]
  onAppointmentClick: (appointment: Appointment) => void
}

function getDateLabel(date: Date): string {
  if (isToday(date)) return "Aujourd'hui"
  if (isTomorrow(date)) return 'Demain'
  return format(date, 'EEEE d MMMM', { locale: fr })
}

export function BookingSidebar({
  professional,
  appointments,
  onAppointmentClick,
}: BookingSidebarProps) {
  // Filter services compatible with professional
  const availableServices = useMemo(() => {
    if (!professional) return []
    return MOCK_BOOKABLE_SERVICES.filter(service =>
      service.compatibleProfessionKeys.some(key => professional.professionKeys.includes(key))
    )
  }, [professional])

  // Get upcoming appointments (today + next 7 days)
  const upcomingAppointments = useMemo(() => {
    const today = startOfDay(new Date())
    return appointments
      .filter(apt => {
        const aptDate = new Date(apt.startTime)
        return aptDate >= today && apt.status !== 'cancelled'
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 8)
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

  const getService = (id: string) => MOCK_BOOKABLE_SERVICES.find(s => s.id === id)
  const getClientNames = (ids: string[]) => {
    if (ids.length === 0) return 'Client a assigner'
    return ids
      .map(id => MOCK_CLIENTS.find(c => c.id === id))
      .filter(Boolean)
      .map(c => `${c!.firstName} ${c!.lastName}`)
      .join(', ')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Services palette */}
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          Services disponibles
        </h3>

        {!professional ? (
          <p className="text-sm text-foreground-muted">Sélectionnez un professionnel</p>
        ) : availableServices.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun service compatible</p>
        ) : (
          <div className="space-y-2">
            {availableServices.map(service => (
              <ServiceDragItem
                key={service.id}
                service={service}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upcoming list */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          A venir
        </h3>

        {upcomingAppointments.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun rendez-vous a venir</p>
        ) : (
          <div className="space-y-4">
            {Array.from(groupedByDay.entries()).map(([dayKey, dayApts]) => {
              const firstApt = dayApts[0]
              if (!firstApt) return null
              return (
              <div key={dayKey}>
                <div className="text-xs font-medium text-foreground-secondary mb-2">
                  {getDateLabel(new Date(firstApt.startTime))}
                </div>
                <div className="space-y-1.5">
                  {dayApts.map(apt => {
                    const service = getService(apt.serviceId)
                    const isDraft = apt.status === 'draft'
                    return (
                      <button
                        key={apt.id}
                        onClick={() => onAppointmentClick(apt)}
                        className="w-full text-left p-2 rounded-lg hover:bg-background-tertiary/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-1 h-8 rounded-full"
                            style={{ backgroundColor: service?.colorHex || '#888' }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className={cn(
                              'text-sm font-medium truncate',
                              isDraft ? 'text-foreground-muted italic' : 'text-foreground'
                            )}>
                              {getClientNames(apt.clientIds)}
                            </div>
                            <div className="text-xs text-foreground-muted">
                              {format(new Date(apt.startTime), 'HH:mm')} · {service?.nameFr}
                              {isDraft && ' · Brouillon'}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  )
}
