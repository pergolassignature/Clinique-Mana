// src/availability/dnd/draggable-availability.tsx

import { useDraggable } from '@dnd-kit/core'
import { format } from 'date-fns'
import { cn } from '@/shared/lib/utils'
import type { AvailabilityBlock } from '../types'

interface DraggableAvailabilityProps {
  block: AvailabilityBlock
  dayIndex: number
  isAvailabilityMode: boolean
  onClick: () => void
  pixelTop: number
  pixelHeight: number
  /** Whether this block is currently being dragged */
  isBeingDragged?: boolean
  /** Highlight when a compatible service is being dragged over */
  isHighlighted?: boolean
  /** Lighten blocks when overlaying availability in booking mode */
  overlayTone?: 'none' | 'light'
  /** Dim blocks that are not valid drop targets */
  isDimmed?: boolean
}

// Colors for availability types
const TYPE_STYLES = {
  available: {
    bg: 'bg-sage-100/80',
    bgActive: 'bg-sage-200',
    border: 'border-sage-300',
    borderActive: 'border-sage-400',
    text: 'text-sage-800',
    stripe: 'bg-sage-500',
  },
  blocked: {
    bg: 'bg-wine-100/60',
    bgActive: 'bg-wine-100',
    border: 'border-wine-300',
    borderActive: 'border-wine-400',
    text: 'text-wine-700',
    stripe: 'bg-wine-500',
  },
  vacation: {
    bg: 'bg-amber-100/60',
    bgActive: 'bg-amber-100',
    border: 'border-amber-300',
    borderActive: 'border-amber-400',
    text: 'text-amber-800',
    stripe: 'bg-amber-500',
  },
  break: {
    bg: 'bg-slate-100/60',
    bgActive: 'bg-slate-100',
    border: 'border-slate-300',
    borderActive: 'border-slate-400',
    text: 'text-slate-700',
    stripe: 'bg-slate-500',
  },
}

const TYPE_LABELS = {
  available: 'Disponible',
  blocked: 'Bloqué',
  vacation: 'Vacances',
  break: 'Pause',
}

/**
 * Resize handle component that is itself a draggable
 */
function ResizeHandle({
  blockId,
  edge,
  disabled,
}: {
  blockId: string
  edge: 'top' | 'bottom'
  disabled?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `avail-${blockId}:resize-${edge}`,
    disabled,
  })
  const { onPointerDown, ...restListeners } = listeners ?? {}

  return (
    <div
      ref={setNodeRef}
      {...restListeners}
      {...attributes}
      className={cn(
        'absolute left-3 right-1 h-3 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center',
        edge === 'top' ? 'top-0' : 'bottom-0',
        isDragging && 'opacity-100'
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        event.stopPropagation()
      }}
    >
      <div className="w-10 h-1 bg-foreground-muted/60 rounded-full" />
    </div>
  )
}

export function DraggableAvailability({
  block,
  dayIndex,
  isAvailabilityMode,
  onClick,
  pixelTop,
  pixelHeight,
  isBeingDragged = false,
  isHighlighted = false,
  overlayTone = 'none',
  isDimmed = false,
}: DraggableAvailabilityProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `avail-${block.id}`,
    disabled: !isAvailabilityMode,
    data: {
      type: 'availability',
      block,
      dayIndex,
    },
  })

  const styles = TYPE_STYLES[block.type]
  const startTime = new Date(block.startTime)
  const endTime = new Date(block.endTime)
  const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000
  const showResizeHandles = isAvailabilityMode && durationMinutes >= 30

  // Handle click only if not dragging
  const handleClick = (e: React.MouseEvent) => {
    if (isDragging || isBeingDragged) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    onClick()
  }

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
        // Reduce opacity when dragging (original stays in place)
        (isDragging || isBeingDragged) && 'opacity-50'
      )}
    >
      <div
        {...(isAvailabilityMode ? { ...listeners, ...attributes } : { role: 'button', tabIndex: 0 })}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className={cn(
          'group w-full h-full rounded-lg border-2 transition-all text-left overflow-hidden relative',
          // Base colors - more vibrant in availability mode
          isAvailabilityMode ? styles.bgActive : styles.bg,
          isAvailabilityMode ? styles.borderActive : styles.border,
          // Interactive states
        isAvailabilityMode
            ? 'cursor-grab active:cursor-grabbing hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-1'
            : 'opacity-50 cursor-default',
          overlayTone === 'light' && !isAvailabilityMode && 'opacity-30',
          isDimmed && 'opacity-20',
          // Highlighted state when dragging service
          isHighlighted && 'opacity-100 bg-sage-200 border-sage-500 shadow-lg animate-pulse scale-[1.02]',
          // Dragging state
          isDragging && 'shadow-lg ring-2 ring-sage-400'
        )}
      >
        {/* Left color stripe */}
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1.5 rounded-l-md',
            styles.stripe,
            !isAvailabilityMode && 'opacity-50'
          )}
        />

        {/* Top resize handle */}
        {showResizeHandles && (
          <ResizeHandle blockId={block.id} edge="top" disabled={!isAvailabilityMode} />
        )}

        {/* Content */}
        <div className="p-2 pl-4 h-full flex flex-col">
          <div className={cn('text-xs font-semibold', styles.text)}>
            {isHighlighted ? 'Déposer ici' : TYPE_LABELS[block.type]}
            {block.label && block.type !== 'available' && (
              <span className="font-normal ml-1">· {block.label}</span>
            )}
          </div>

          {(isAvailabilityMode || isHighlighted) && (
            <div className="text-[11px] text-foreground-secondary mt-0.5">
              {format(startTime, 'HH:mm')} – {format(endTime, 'HH:mm')}
            </div>
          )}

          {/* Duration badge for longer blocks */}
          {isAvailabilityMode && durationMinutes >= 60 && (
            <div className="mt-auto">
              <span className="text-[10px] text-foreground-muted">
                {Math.floor(durationMinutes / 60)}h{durationMinutes % 60 > 0 ? `${durationMinutes % 60}` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Bottom resize handle */}
        {showResizeHandles && (
          <ResizeHandle blockId={block.id} edge="bottom" disabled={!isAvailabilityMode} />
        )}
      </div>
    </div>
  )
}

/**
 * Ghost version for drag overlay - just the visual, no draggable logic
 */
export function AvailabilityDragOverlay({
  block,
  pixelHeight,
}: {
  block: AvailabilityBlock
  pixelHeight: number
}) {
  const styles = TYPE_STYLES[block.type]
  const startTime = new Date(block.startTime)
  const endTime = new Date(block.endTime)
  const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000

  return (
    <div
      style={{ height: `${pixelHeight}px`, width: '100%' }}
      className={cn(
        'rounded-lg border-2 overflow-hidden relative shadow-xl',
        styles.bgActive,
        styles.borderActive,
        'ring-2 ring-sage-400 ring-offset-2'
      )}
    >
      {/* Left color stripe */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1.5 rounded-l-md', styles.stripe)} />

      {/* Content */}
      <div className="p-2 pl-4 h-full flex flex-col">
        <div className={cn('text-xs font-semibold', styles.text)}>
          {TYPE_LABELS[block.type]}
        </div>
        <div className="text-[11px] text-foreground-secondary mt-0.5">
          {format(startTime, 'HH:mm')} – {format(endTime, 'HH:mm')}
        </div>
        {durationMinutes >= 60 && (
          <div className="mt-auto">
            <span className="text-[10px] text-foreground-muted">
              {Math.floor(durationMinutes / 60)}h{durationMinutes % 60 > 0 ? `${durationMinutes % 60}` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
