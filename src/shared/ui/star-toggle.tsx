import { Star } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/tooltip'

export interface StarToggleProps {
  isSpecialized: boolean
  onToggle: () => void
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}

export function StarToggle({
  isSpecialized,
  onToggle,
  disabled = false,
  className,
  size = 'sm',
}: StarToggleProps) {
  const sizeClasses = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
  }

  const tooltipText = isSpecialized
    ? 'Retirer la spécialisation'
    : 'Marquer comme spécialisé'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (!disabled) onToggle()
          }}
          disabled={disabled}
          className={cn(
            'inline-flex items-center justify-center rounded-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/30',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110',
            className
          )}
          aria-label={tooltipText}
          aria-pressed={isSpecialized}
        >
          <Star
            className={cn(
              sizeClasses[size],
              'transition-colors',
              isSpecialized
                ? 'fill-amber-400 text-amber-400'
                : 'fill-transparent text-gray-400 hover:text-amber-300'
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}
