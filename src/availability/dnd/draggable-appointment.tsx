// src/availability/dnd/draggable-appointment.tsx

import { useDraggable } from '@dnd-kit/core'
import { format } from 'date-fns'
import { cn } from '@/shared/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/shared/ui/tooltip'
import type { Appointment, Service, Client, BookableService } from '../types'

// Density thresholds in pixels
const DENSITY_PILL = 24 // < 24px: pill only with initials
const DENSITY_COMPACT = 44 // < 44px: name + time only

interface DraggableAppointmentProps {
  appointment: Appointment
  service?: Service | BookableService
  clients?: (Client | undefined)[]
  dayIndex: number
  onClick: () => void
  pixelTop: number
  pixelHeight: number
  /** Whether this appointment is currently being dragged */
  isBeingDragged?: boolean
}

/**
 * Resize handle component that is itself a draggable
 */
function ResizeHandle({
  appointmentId,
  edge,
  disabled,
}: {
  appointmentId: string
  edge: 'top' | 'bottom'
  disabled?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `apt-${appointmentId}:resize-${edge}`,
    disabled,
  })
  const { onPointerDown, ...restListeners } = listeners ?? {}

  return (
    <div
      ref={setNodeRef}
      {...restListeners}
      {...attributes}
      className={cn(
        'absolute left-2 right-2 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10',
        edge === 'top' ? 'top-0' : 'bottom-0',
        isDragging && 'opacity-100'
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        event.stopPropagation()
      }}
    >
      <div
        className={cn(
          'w-8 h-1 bg-foreground-muted/40 rounded-full mx-auto',
          edge === 'top' ? 'mt-0.5' : 'mb-0.5'
        )}
      />
    </div>
  )
}

export function DraggableAppointment({
  appointment,
  service,
  clients,
  dayIndex,
  onClick,
  pixelTop,
  pixelHeight,
  isBeingDragged = false,
}: DraggableAppointmentProps) {
  const isCancelled = appointment.status === 'cancelled'
  const isCreated = appointment.status === 'created'
  const isInteractive = !isCancelled

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `apt-${appointment.id}`,
    disabled: !isInteractive,
    data: {
      type: 'appointment',
      appointment,
      dayIndex,
    },
  })

  const startTime = new Date(appointment.startTime)
  const endTime = new Date(startTime.getTime() + appointment.durationMinutes * 60000)

  // Build client details
  const validClients = clients?.filter((c): c is Client => c !== undefined) || []
  const clientName = validClients.length > 0
    ? validClients.map(c => `${c.firstName} ${c.lastName}`).join(', ')
    : 'Client inconnu'
  // Density mode based on pixel height
  const isPillMode = pixelHeight < DENSITY_PILL
  const isCompactMode = pixelHeight < DENSITY_COMPACT && !isPillMode
  const isFullMode = !isPillMode && !isCompactMode

  // Show resize handles only for full mode and not cancelled
  const showResizeHandles = isFullMode && !isCancelled

  // Handle click only if not dragging
  const handleClick = (e: React.MouseEvent) => {
    if (isDragging || isBeingDragged) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    onClick()
  }

  // Tooltip content with full details
  const tooltipContent = (
    <div className="space-y-1.5 max-w-[200px]">
      <div className="font-medium text-sm">{clientName}</div>
      <div className="text-foreground-muted">{service?.nameFr || 'Service'}</div>
      <div className="flex items-center gap-2 text-foreground-muted">
        <span>{format(startTime, 'HH:mm')} – {format(endTime, 'HH:mm')}</span>
        <span className="text-foreground-muted/60">({appointment.durationMinutes} min)</span>
      </div>
      {isCancelled && (
        <div className="text-wine-500 font-medium">Annulé</div>
      )}
      {isCreated && (
        <div className="text-amber-600 font-medium">Brouillon</div>
      )}
    </div>
  )

  const blockContent = (
    <div
      {...(isInteractive ? { ...listeners, ...attributes } : { role: 'button', tabIndex: 0 })}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick(e as unknown as React.MouseEvent)
        }
      }}
      className={cn(
        'group relative w-full h-full rounded-lg text-left transition-all overflow-hidden',
        'border shadow-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-1',
        // Base styles based on status
        isCancelled && 'opacity-50',
        isCreated && 'border-dashed',
        // Cursor styles
        isInteractive && !isDragging && 'cursor-grab hover:shadow-md',
        isInteractive && isDragging && 'cursor-grabbing',
        // Drag visual feedback
        isDragging && 'shadow-lg ring-2 ring-sage-400 opacity-90'
      )}
      style={{
        backgroundColor: isCancelled ? 'var(--background-tertiary)' : `${service?.colorHex}3d`,
        borderColor: isCancelled ? 'var(--border-light)' : `${service?.colorHex}85`,
      }}
    >
      {/* Left color stripe - always visible */}
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 rounded-l-lg',
          isCancelled && 'opacity-40'
        )}
        style={{ backgroundColor: service?.colorHex || '#888888' }}
      />

      {/* Top resize handle */}
      {showResizeHandles && (
        <ResizeHandle appointmentId={appointment.id} edge="top" disabled={!isInteractive} />
      )}

      {/* Content area with left padding for color stripe */}
      <div className={cn(
        'flex h-full overflow-hidden pl-2.5',
        isPillMode ? 'items-center px-2' : 'flex-col py-1 pr-2'
      )}>
        {/* PILL MODE: client name only */}
        {isPillMode && (
          <div className={cn(
            'text-[10px] font-medium truncate leading-none',
            isCancelled ? 'line-through text-foreground-muted' : 'text-foreground'
          )}>
            {clientName}
          </div>
        )}

        {/* COMPACT MODE: name + time */}
        {isCompactMode && (
          <>
            <div className={cn(
              'text-xs font-medium truncate leading-tight',
              isCancelled ? 'line-through text-foreground-muted' : 'text-foreground'
            )}>
              {clientName}
            </div>
            <div className="text-[10px] text-foreground-muted mt-auto">
              {format(startTime, 'HH:mm')}
            </div>
          </>
        )}

        {/* FULL MODE: name + service + time */}
        {isFullMode && (
          <>
            <div className={cn(
              'text-xs font-medium truncate',
              isCancelled ? 'line-through text-foreground-muted' : 'text-foreground'
            )}>
              {clientName}
            </div>
            <div className={cn(
              'text-[10px] truncate',
              isCancelled ? 'text-foreground-muted' : 'text-foreground-secondary'
            )}>
              {service?.nameFr || 'Service'}
            </div>
            <div className="text-[10px] text-foreground-muted mt-auto">
              {format(startTime, 'HH:mm')} – {format(endTime, 'HH:mm')}
            </div>
          </>
        )}

        {/* Status indicator for compact/pill modes */}
        {(isPillMode || isCompactMode) && isCancelled && (
          <div className={cn(
            'text-[8px] text-wine-600 font-medium',
            isPillMode && 'ml-1'
          )}>
            ✕
          </div>
        )}
        {(isPillMode || isCompactMode) && isCreated && (
          <div className={cn(
            'text-[8px] text-amber-600 font-medium',
            isPillMode && 'ml-1'
          )}>
            •
          </div>
        )}
      </div>

      {/* Bottom resize handle */}
      {showResizeHandles && (
        <ResizeHandle appointmentId={appointment.id} edge="bottom" disabled={!isInteractive} />
      )}
    </div>
  )

  // Wrap in positioned container
  const positionedBlock = (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        top: `${pixelTop}px`,
        height: `${pixelHeight}px`,
        left: 0,
        right: 0,
      }}
      className={cn(
        // Reduce opacity when dragging (original stays in place)
        (isDragging || isBeingDragged) && 'opacity-50'
      )}
    >
      {blockContent}
    </div>
  )

  // Wrap in tooltip for pill and compact modes
  if (isPillMode || isCompactMode) {
    return (
      <div
        ref={setNodeRef}
        style={{
          position: 'absolute',
          top: `${pixelTop}px`,
          height: `${pixelHeight}px`,
          left: 0,
          right: 0,
        }}
        className={cn(
          (isDragging || isBeingDragged) && 'opacity-50'
        )}
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              {blockContent}
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="bg-background border border-border text-foreground p-3"
            >
              {tooltipContent}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    )
  }

  return positionedBlock
}

/**
 * Ghost version for drag overlay - just the visual, no draggable logic
 */
export function AppointmentDragOverlay({
  appointment,
  service,
  clients,
  pixelHeight,
}: {
  appointment: Appointment
  service?: Service | BookableService
  clients?: (Client | undefined)[]
  pixelHeight: number
}) {
  const startTime = new Date(appointment.startTime)
  const endTime = new Date(startTime.getTime() + appointment.durationMinutes * 60000)
  const isCancelled = appointment.status === 'cancelled'
  const isCreated = appointment.status === 'created'

  // Build client details
  const validClients = clients?.filter((c): c is Client => c !== undefined) || []
  const clientName = validClients.length > 0
    ? validClients.map(c => `${c.firstName} ${c.lastName}`).join(', ')
    : 'Client inconnu'

  return (
    <div
      style={{
        height: `${pixelHeight}px`,
        width: '100%',
        backgroundColor: isCancelled ? 'var(--background-tertiary)' : `${service?.colorHex}15`,
        borderColor: isCancelled ? 'var(--border-light)' : `${service?.colorHex}50`,
      }}
      className={cn(
        'rounded-lg border overflow-hidden relative shadow-xl',
        'ring-2 ring-sage-400 ring-offset-2',
        isCreated && 'border-dashed'
      )}
    >
      {/* Left color stripe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{ backgroundColor: service?.colorHex || '#888888' }}
      />

      {/* Content */}
      <div className="flex flex-col py-1 pr-2 pl-2.5 h-full overflow-hidden">
        <div className="text-xs font-medium truncate text-foreground">
          {clientName}
        </div>
        <div className="text-[10px] truncate text-foreground-secondary">
          {service?.nameFr || 'Service'}
        </div>
        <div className="text-[10px] text-foreground-muted mt-auto">
          {format(startTime, 'HH:mm')} – {format(endTime, 'HH:mm')}
        </div>
      </div>
    </div>
  )
}
