// src/availability/dnd/draggable-service.tsx

import { useDraggable } from '@dnd-kit/core'
import { cn } from '@/shared/lib/utils'
import type { BookableService } from '../types'

interface DraggableServiceProps {
  service: BookableService
  children: React.ReactNode
  className?: string
  disabled?: boolean
}

/**
 * Draggable wrapper for services in the sidebar.
 * When dropped on the calendar, creates a new appointment.
 */
export function DraggableService({
  service,
  children,
  className,
  disabled = false,
}: DraggableServiceProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `service-${service.id}`,
    disabled,
    data: {
      type: 'service',
      service,
    },
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50',
        className
      )}
    >
      {children}
    </div>
  )
}
