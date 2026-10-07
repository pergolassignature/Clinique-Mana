import { Star } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'
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
            'inline-flex items-center justify-center rounded-md p-0.5 transition-colors',
            focusRing,
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
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
                ? 'fill-warning text-warning'
                : 'fill-transparent text-subtle hover:text-warning'
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
