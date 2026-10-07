// src/availability/dnd/draggable-create-slot.tsx

import { useDraggable } from '@dnd-kit/core'
import type { PointerEventHandler } from 'react'
import { cn } from '@/shared/lib/utils'

interface DraggableCreateSlotProps {
  dayIndex: number
  enabled: boolean
  children: React.ReactNode
  className?: string
  onPointerMove?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
}

/**
 * Invisible draggable layer that covers a day column for creating new availability.
 * When dragging starts on this layer (not on an existing block), it triggers create-availability.
 */
export function DraggableCreateSlot({
  dayIndex,
  enabled,
  children,
  className,
  onPointerMove,
  onPointerLeave,
}: DraggableCreateSlotProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `create-slot-${dayIndex}`,
    disabled: !enabled,
    data: {
      type: 'create-slot',
      dayIndex,
    },
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn(
        'absolute inset-0 z-[5]',
        enabled && 'cursor-crosshair',
        isDragging && 'cursor-grabbing',
        className
      )}
    >
      {children}
    </div>
  )
}
