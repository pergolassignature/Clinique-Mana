// src/availability/components/availability-block-visual.tsx

import { format } from 'date-fns'
import { cn } from '@/shared/lib/utils'
import type { AvailabilityBlock } from '../types'

interface AvailabilityBlockVisualProps {
  block: AvailabilityBlock
  onClick: () => void
  isAvailabilityMode: boolean
  /** Highlight when a compatible service is being dragged over */
  isHighlighted?: boolean
  /** Called when user starts resizing from top or bottom edge */
  onResizeStart?: (e: React.PointerEvent, edge: 'top' | 'bottom') => void
}

// More vibrant colors for availability mode
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
  imported: {
    bg: 'bg-purple-50/60',
    bgActive: 'bg-purple-100',
    border: 'border-purple-300 border-dashed',
    borderActive: 'border-purple-400 border-dashed',
    text: 'text-purple-700',
    stripe: 'bg-purple-400',
  },
}

const TYPE_LABELS = {
  available: 'Disponible',
  blocked: 'Bloqué',
  vacation: 'Vacances',
  break: 'Pause',
  imported: 'Occupé',
}

export function AvailabilityBlockVisual({
  block,
  onClick,
  isAvailabilityMode,
  isHighlighted = false,
  onResizeStart,
}: AvailabilityBlockVisualProps) {
  const styles = TYPE_STYLES[block.type]
  const startTime = new Date(block.startTime)
  const endTime = new Date(block.endTime)

  // Calculate duration in minutes for display
  const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000
  // Imported blocks are read-only - no resize handles
  const isImported = block.type === 'imported'
  const showResizeHandles = isAvailabilityMode && durationMinutes >= 30 && !isImported

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
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
        isImported
          // Imported blocks: clickable to show info, but cursor indicates read-only
          ? 'cursor-help hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-1'
          : isAvailabilityMode
            ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-1'
            : 'opacity-50 cursor-default',
        // Highlighted state when dragging service
        isHighlighted && 'opacity-100 bg-sage-200 border-sage-500 shadow-lg animate-pulse scale-[1.02]'
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
      {showResizeHandles && onResizeStart && (
        <div
          className="absolute top-0 left-3 right-1 h-3 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center"
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart(e, 'top')
          }}
        >
          <div className="w-10 h-1 bg-foreground-muted/60 rounded-full" />
        </div>
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
      {showResizeHandles && onResizeStart && (
        <div
          className="absolute bottom-0 left-3 right-1 h-3 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center"
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart(e, 'bottom')
          }}
        >
          <div className="w-10 h-1 bg-foreground-muted/60 rounded-full" />
        </div>
      )}
    </div>
  )
}
