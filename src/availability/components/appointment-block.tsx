// src/availability/components/appointment-block.tsx

import { format } from 'date-fns'
import { cn } from '@/shared/lib/utils'
import type { Appointment, Service, Client } from '../types'

interface AppointmentBlockProps {
  appointment: Appointment
  service?: Service
  client?: Client
  onClick: () => void
}

export function AppointmentBlock({
  appointment,
  service,
  client,
  onClick,
}: AppointmentBlockProps) {
  const startTime = new Date(appointment.startTime)
  const endTime = new Date(startTime.getTime() + appointment.durationMinutes * 60000)
  const isCancelled = appointment.status === 'cancelled'

  const clientName = client
    ? `${client.firstName} ${client.lastName}`
    : 'Client inconnu'

  // Calculate if we have enough height for full display
  const isCompact = appointment.durationMinutes <= 30

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full h-full rounded-lg px-2 py-1 text-left transition-all',
        'border shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-1',
        isCancelled
          ? 'bg-background-tertiary/60 border-border-light opacity-60'
          : 'border-transparent'
      )}
      style={{
        backgroundColor: isCancelled ? undefined : `${service?.colorHex}20`,
        borderColor: isCancelled ? undefined : `${service?.colorHex}40`,
      }}
    >
      <div className="flex flex-col h-full overflow-hidden">
        {/* Client name */}
        <div
          className={cn(
            'text-xs font-medium truncate',
            isCancelled ? 'line-through text-foreground-muted' : 'text-foreground'
          )}
        >
          {clientName}
        </div>

        {!isCompact && (
          <>
            {/* Service name */}
            <div
              className={cn(
                'text-[10px] truncate',
                isCancelled ? 'text-foreground-muted' : 'text-foreground-secondary'
              )}
            >
              {service?.nameFr || 'Service'}
            </div>

            {/* Time range */}
            <div className="text-[10px] text-foreground-muted mt-auto">
              {format(startTime, 'HH:mm')} – {format(endTime, 'HH:mm')}
            </div>
          </>
        )}

        {/* Cancelled badge for compact view */}
        {isCancelled && isCompact && (
          <div className="text-[9px] text-wine-600 font-medium">
            Annulé
          </div>
        )}
      </div>
    </button>
  )
}
