// src/availability/components/appointment-block.tsx

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

interface AppointmentBlockProps {
  appointment: Appointment
  service?: Service | BookableService
  clients?: (Client | undefined)[]
  onClick: () => void
  onDragStart?: (e: React.PointerEvent) => void
  onResizeStart?: (e: React.PointerEvent, edge: 'top' | 'bottom') => void
  isDragging?: boolean
  /** Pixel height of the block (calculated by parent) */
  pixelHeight?: number
}

// Get client initials from first name and last name
function getInitials(client: Client): string {
  return `${client.firstName.charAt(0)}${client.lastName.charAt(0)}`.toUpperCase()
}

export function AppointmentBlock({
  appointment,
  service,
  clients,
  onClick,
  onDragStart,
  onResizeStart,
  isDragging = false,
  pixelHeight = 40,
}: AppointmentBlockProps) {
  const startTime = new Date(appointment.startTime)
  const endTime = new Date(startTime.getTime() + appointment.durationMinutes * 60000)
  const isCancelled = appointment.status === 'cancelled'
  const isCreated = appointment.status === 'created'

  // Build client details
  const validClients = clients?.filter((c): c is Client => c !== undefined) || []
  const clientName = validClients.length > 0
    ? validClients.map(c => `${c.firstName} ${c.lastName}`).join(', ')
    : 'Client inconnu'
  const clientInitials = validClients.length > 0
    ? validClients.map(getInitials).join(', ')
    : '??'

  // Density mode based on pixel height
  const isPillMode = pixelHeight < DENSITY_PILL
  const isCompactMode = pixelHeight < DENSITY_COMPACT && !isPillMode
  const isFullMode = !isPillMode && !isCompactMode

  // Show resize handles only for full mode and not cancelled
  const showResizeHandles = isFullMode && !isCancelled

  // Allow drag/resize interactions for non-cancelled appointments
  const isInteractive = !isCancelled

  const handleClick = () => {
    if (isDragging) return
    onClick()
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isInteractive || !onDragStart) return
    onDragStart(e)
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
        'group relative w-full h-full rounded-lg text-left transition-all overflow-hidden',
        'border shadow-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-1',
        // Base styles based on status
        isCancelled && 'opacity-50',
        isCreated && 'border-dashed',
        // Cursor styles
        isInteractive && !isDragging && 'cursor-grab hover:shadow-md hover:scale-[1.01]',
        isInteractive && isDragging && 'cursor-grabbing',
        // Drag visual feedback
        isDragging && 'shadow-lg ring-2 ring-sage-400 opacity-90'
      )}
      style={{
        backgroundColor: isCancelled ? 'var(--background-tertiary)' : `${service?.colorHex}15`,
        borderColor: isCancelled ? 'var(--border-light)' : `${service?.colorHex}50`,
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

      {/* Content area with left padding for color stripe */}
      <div className={cn(
        'flex h-full overflow-hidden pl-2.5',
        isPillMode ? 'items-center px-2' : 'flex-col py-1 pr-2'
      )}>
        {/* PILL MODE: initials only */}
        {isPillMode && (
          <div className={cn(
            'text-[10px] font-semibold truncate',
            isCancelled ? 'line-through text-foreground-muted' : 'text-foreground'
          )}>
            {clientInitials}
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

  // Wrap in tooltip for pill and compact modes
  if (isPillMode || isCompactMode) {
    return (
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
    )
  }

  return blockContent
}
