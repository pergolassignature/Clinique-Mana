// src/availability/components/appointment-block.tsx

import { format } from 'date-fns'
import { cn } from '@/shared/lib/utils'
import type { Appointment, Service, Client } from '../types'

interface AppointmentBlockProps {
  appointment: Appointment
  service?: Service
  client?: Client
  onClick: () => void
  onDragStart?: (e: React.PointerEvent) => void
  onResizeStart?: (e: React.PointerEvent, edge: 'top' | 'bottom') => void
  isDragging?: boolean
}

export function AppointmentBlock({
  appointment,
  service,
  client,
  onClick,
  onDragStart,
  onResizeStart,
  isDragging = false,
}: AppointmentBlockProps) {
  const startTime = new Date(appointment.startTime)
  const endTime = new Date(startTime.getTime() + appointment.durationMinutes * 60000)
  const isCancelled = appointment.status === 'cancelled'

  const clientName = client
    ? `${client.firstName} ${client.lastName}`
    : 'Client inconnu'

  // Calculate if we have enough height for full display
  const isCompact = appointment.durationMinutes <= 30

  // Show resize handles for appointments > 30 min and not cancelled
  const showResizeHandles = appointment.durationMinutes > 30 && !isCancelled

  // Allow drag/resize interactions for non-cancelled appointments
  const isInteractive = !isCancelled

  const handleClick = () => {
    // Prevent click when finishing a drag operation
    if (isDragging) return
    onClick()
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isInteractive || !onDragStart) return
    onDragStart(e)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      className={cn(
        'group relative w-full h-full rounded-lg px-2 py-1 text-left transition-all',
        'border shadow-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-1',
        // Base styles based on cancelled state
        isCancelled
          ? 'bg-background-tertiary/60 border-border-light opacity-60'
          : 'border-transparent',
        // Cursor styles for interactive appointments
        isInteractive && !isDragging && 'cursor-grab hover:shadow-md',
        isInteractive && isDragging && 'cursor-grabbing',
        // Drag visual feedback
        isDragging && 'shadow-lg ring-2 ring-sage-400 opacity-90'
      )}
      style={{
        backgroundColor: isCancelled ? undefined : `${service?.colorHex}20`,
        borderColor: isCancelled ? undefined : `${service?.colorHex}40`,
      }}
    >
      {/* Top resize handle */}
      {showResizeHandles && (
        <div
          className="absolute top-0 left-2 right-2 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart?.(e, 'top')
          }}
        >
          <div className="w-8 h-1 bg-foreground-muted/40 rounded-full mx-auto mt-0.5" />
        </div>
      )}

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

      {/* Bottom resize handle */}
      {showResizeHandles && (
        <div
          className="absolute bottom-0 left-2 right-2 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart?.(e, 'bottom')
          }}
        >
          <div className="w-8 h-1 bg-foreground-muted/40 rounded-full mx-auto mb-0.5" />
        </div>
      )}
    </div>
  )
}
