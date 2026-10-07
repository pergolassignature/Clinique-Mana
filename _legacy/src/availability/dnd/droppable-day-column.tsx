// src/availability/dnd/droppable-day-column.tsx

import { useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/shared/lib/utils'

interface DroppableDayColumnProps {
  dayIndex: number
  children: React.ReactNode
  className?: string
  /** Callback to register the column element for position calculations */
  onRegister?: (dayIndex: number, element: HTMLElement | null) => void
  /** Whether the column is a valid drop target for the current drag */
  isValidDropTarget?: boolean
  /** Whether to show a full-column drop highlight */
  showDropHighlight?: boolean
}

export function DroppableDayColumn({
  dayIndex,
  children,
  className,
  onRegister,
  isValidDropTarget = true,
  showDropHighlight = true,
}: DroppableDayColumnProps) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `day-${dayIndex}`,
    disabled: !isValidDropTarget,
  })

  // Register the element for position calculations
  useEffect(() => {
    // We need to get the actual DOM element
    // useDroppable's setNodeRef is a callback ref, so we use a combined ref approach
  }, [])

  const combinedRef = (element: HTMLElement | null) => {
    setNodeRef(element)
    onRegister?.(dayIndex, element)
  }

  const isDragging = !!active
  const shouldHighlight = showDropHighlight && isDragging && isOver && isValidDropTarget

  return (
    <div
      ref={combinedRef}
      data-day-column
      data-day-index={dayIndex}
      className={cn(
        'relative',
        shouldHighlight && 'bg-sage-50/50',
        className
      )}
    >
      {children}
    </div>
  )
}
