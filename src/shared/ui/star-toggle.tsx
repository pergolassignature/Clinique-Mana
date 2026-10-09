import { Star } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

interface StarToggleProps {
  /** Marked as a specialisation. */
  specialized: boolean
  onToggle: () => void
  /** The id of the text naming the item (its label), read after the action: « Marquer comme spécialisé, Couples ». */
  describedBy?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

/**
 * The star that marks a held item (a clientèle, an approach) as a specialisation (design system
 * StarToggle). Its name says what a press does (« Marquer comme spécialisé » / « Retirer la
 * spécialisation »), shown in the tooltip too; the filled star shows the state. Space, Enter or a
 * click toggles it; it changes the caller's draft only (decision #36). The filled star is yellow-700
 * (an icon that must be seen, decision #30); an invisible ::after enlarges the hit area to 32×32.
 */
export function StarToggle({ specialized, onToggle, describedBy, disabled = false, size = 'sm' }: StarToggleProps) {
  const label = t(specialized ? 'common.star.remove' : 'common.star.add')
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={onToggle}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center rounded-md p-0.5 after:absolute after:-inset-[7px] after:content-[''] transition-colors duration-120 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
              focusRing,
              specialized ? 'text-warning-strong' : 'text-subtle',
            )}
          >
            <Star aria-hidden className={size === 'md' ? 'size-4' : 'size-3.5'} fill={specialized ? 'currentColor' : 'none'} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
