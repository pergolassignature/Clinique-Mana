// src/availability/components/availability-block-visual.tsx

import { format } from 'date-fns'
import { cn } from '@/shared/lib/utils'
import type { AvailabilityBlock } from '../types'

interface AvailabilityBlockVisualProps {
  block: AvailabilityBlock
  onClick: () => void
  isAvailabilityMode: boolean
}

const TYPE_STYLES = {
  available: {
    bg: 'bg-sage-50/60',
    border: 'border-sage-200',
    text: 'text-sage-700',
  },
  blocked: {
    bg: 'bg-wine-50/40',
    border: 'border-wine-200',
    text: 'text-wine-600',
  },
  vacation: {
    bg: 'bg-amber-50/40',
    border: 'border-amber-200',
    text: 'text-amber-700',
  },
  break: {
    bg: 'bg-slate-50/40',
    border: 'border-slate-200',
    text: 'text-slate-600',
  },
}

export function AvailabilityBlockVisual({
  block,
  onClick,
  isAvailabilityMode,
}: AvailabilityBlockVisualProps) {
  const styles = TYPE_STYLES[block.type]
  const startTime = new Date(block.startTime)
  const endTime = new Date(block.endTime)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full h-full rounded-md border transition-all text-left overflow-hidden',
        styles.bg,
        styles.border,
        isAvailabilityMode
          ? 'opacity-100 hover:shadow-sm cursor-pointer'
          : 'opacity-40 cursor-default pointer-events-none'
      )}
    >
      <div className="p-1.5">
        <div className={cn('text-[10px] font-medium uppercase tracking-wide', styles.text)}>
          {block.type === 'available' ? 'Dispo' : block.label || block.type}
        </div>
        {isAvailabilityMode && (
          <div className="text-[10px] text-foreground-muted">
            {format(startTime, 'HH:mm')}–{format(endTime, 'HH:mm')}
          </div>
        )}
      </div>
    </button>
  )
}
