// src/availability/dnd/calendar-drag-overlay.tsx

import { DragOverlay } from '@dnd-kit/core'
import { minutesToPixel, DEFAULT_CONFIG, type TimeGridConfig } from '../utils/time-grid'
import { AvailabilityDragOverlay } from './draggable-availability'
import { AppointmentDragOverlay } from './draggable-appointment'
import type { AvailabilityBlock, Appointment, BookableService, Client } from '../types'
import type { DragState } from '../hooks/use-calendar-dnd'

interface CalendarDragOverlayProps {
  dragState: DragState
  config?: TimeGridConfig
  /** Get availability block by ID for overlay rendering */
  getAvailabilityBlock?: (id: string) => AvailabilityBlock | null
  /** Get appointment by ID for overlay rendering */
  getAppointment?: (id: string) => Appointment | null
  /** Get service by ID */
  getService?: (id: string) => BookableService | null
  /** Get clients by IDs */
  getClients?: (ids: string[]) => (Client | undefined)[]
}

/**
 * Preview rectangle for create-availability drag
 */
function CreatePreview({
  startMinutes,
  endMinutes,
  config = DEFAULT_CONFIG,
}: {
  startMinutes: number
  endMinutes: number
  config?: TimeGridConfig
}) {
  const top = minutesToPixel(startMinutes, config)
  const height = minutesToPixel(endMinutes, config) - top

  return (
    <div
      className="rounded-lg bg-sage-200/50 border-2 border-dashed border-sage-400 pointer-events-none"
      style={{
        height: `${height}px`,
        width: '100%',
      }}
    >
      <div className="p-2 text-xs text-sage-700 font-medium">
        Nouvelle disponibilité
      </div>
    </div>
  )
}

/**
 * Service drop preview
 */
function ServiceDropPreview({
  service,
  startMinutes,
  endMinutes,
  config = DEFAULT_CONFIG,
}: {
  service: BookableService | null
  startMinutes: number
  endMinutes: number
  config?: TimeGridConfig
}) {
  const top = minutesToPixel(startMinutes, config)
  const height = minutesToPixel(endMinutes, config) - top

  return (
    <div
      className="rounded-lg border-2 border-dashed overflow-hidden pointer-events-none"
      style={{
        height: `${height}px`,
        width: '100%',
        backgroundColor: `${service?.colorHex || '#888888'}20`,
        borderColor: `${service?.colorHex || '#888888'}80`,
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{ backgroundColor: service?.colorHex || '#888888' }}
      />
      <div className="p-2 pl-3">
        <div className="text-xs font-medium text-foreground">
          Nouveau rendez-vous
        </div>
        <div className="text-[10px] text-foreground-secondary">
          {service?.nameFr || 'Service'}
        </div>
      </div>
    </div>
  )
}

export function CalendarDragOverlayContent({
  dragState,
  config = DEFAULT_CONFIG,
  getAvailabilityBlock,
  getAppointment,
  getService,
  getClients,
}: CalendarDragOverlayProps) {
  const { context, activeId, preview } = dragState

  // Nothing to render if not dragging or no preview
  if (context === 'idle' || !preview) {
    return null
  }

  const height = minutesToPixel(preview.endMinutes, config) - minutesToPixel(preview.startMinutes, config)

  // Render based on drag context
  switch (context) {
    case 'create-availability':
      return (
        <CreatePreview
          startMinutes={preview.startMinutes}
          endMinutes={preview.endMinutes}
          config={config}
        />
      )

    case 'move-availability':
    case 'resize-availability': {
      const block = activeId ? getAvailabilityBlock?.(activeId) : null
      if (!block) return null
      return (
        <AvailabilityDragOverlay
          block={block}
          pixelHeight={height}
        />
      )
    }

    case 'move-appointment':
    case 'resize-appointment': {
      const apt = activeId ? getAppointment?.(activeId) : null
      if (!apt) return null
      const service = getService?.(apt.serviceId)
      const clients = getClients?.(apt.clientIds)
      return (
        <AppointmentDragOverlay
          appointment={apt}
          service={service ?? undefined}
          clients={clients}
          pixelHeight={height}
        />
      )
    }

    case 'service-drop': {
      const service = activeId ? getService?.(activeId) ?? null : null
      return (
        <ServiceDropPreview
          service={service}
          startMinutes={preview.startMinutes}
          endMinutes={preview.endMinutes}
          config={config}
        />
      )
    }

    default:
      return null
  }
}

/**
 * Complete DragOverlay wrapper component
 */
export function CalendarDragOverlay(props: CalendarDragOverlayProps) {
  const { dragState } = props

  // Don't render anything if not dragging
  if (
    dragState.context === 'idle' ||
    dragState.context === 'create-availability' ||
    dragState.context === 'service-drop'
  ) {
    return null
  }

  return (
    <DragOverlay
      dropAnimation={{
        duration: 200,
        easing: 'ease',
      }}
    >
      <CalendarDragOverlayContent {...props} />
    </DragOverlay>
  )
}
