import { Lock, Archive, MoreHorizontal, RotateCcw } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'

interface MotifCardProps {
  motifKey: string
  label: string
  description?: string
  isRestricted?: boolean
  restrictionReason?: string
  isActive?: boolean
  onSelect?: () => void
  isSelected?: boolean
  /** Called when archive action is triggered */
  onArchive?: () => void
  /** Called when restore action is triggered */
  onRestore?: () => void
  /** Show action menu for management */
  showActions?: boolean
  className?: string
}

export function MotifCard({
  motifKey: _motifKey,
  label,
  description,
  isRestricted = false,
  restrictionReason,
  isActive = true,
  onSelect,
  isSelected = false,
  onArchive,
  onRestore,
  showActions = false,
  className,
}: MotifCardProps) {
  const isArchived = !isActive
  const isClickable = !!onSelect && !isRestricted && !isArchived

  const handleClick = () => {
    if (isClickable) {
      onSelect()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onSelect()
    }
  }

  const cardContent = (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative rounded-xl border p-4 transition-all duration-200',
        // Default state
        'border-border bg-background',
        // Hover state (only when clickable)
        isClickable && 'cursor-pointer hover:border-sage-300 hover:bg-sage-50 hover:shadow-soft',
        // Selected state
        isSelected && 'border-sage-400 bg-sage-50 shadow-soft',
        // Restricted state
        isRestricted && 'opacity-60',
        // Archived state
        isArchived && 'opacity-50 bg-background-secondary/50',
        className
      )}
    >
      {/* Status indicators and actions */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        {/* Archived badge */}
        {isArchived && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-foreground-muted/10 text-foreground-muted">
            <Archive className="h-2.5 w-2.5" />
            Archivé
          </span>
        )}
        {/* Restricted indicator */}
        {isRestricted && !isArchived && (
          <Lock className="h-3.5 w-3.5 text-foreground-muted" />
        )}
        {/* Actions menu */}
        {showActions && (onArchive || onRestore) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              {isArchived && onRestore && (
                <DropdownMenuItem onClick={onRestore}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('pages.motifs.actions.restore')}
                </DropdownMenuItem>
              )}
              {!isArchived && onArchive && (
                <DropdownMenuItem onClick={onArchive}>
                  <Archive className="h-3.5 w-3.5" />
                  {t('pages.motifs.actions.archive')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Label */}
      <h3
        className={cn(
          'text-sm font-medium leading-tight pr-16',
          isSelected ? 'text-sage-700' : 'text-foreground',
          (isRestricted || isArchived) && 'text-foreground-muted'
        )}
      >
        {label}
      </h3>

      {/* Description (optional) */}
      {description && (
        <p
          className={cn(
            'mt-1.5 text-xs leading-relaxed line-clamp-3',
            (isRestricted || isArchived) ? 'text-foreground-muted/70' : 'text-foreground-secondary'
          )}
        >
          {description}
        </p>
      )}
    </div>
  )

  // Wrap in tooltip if restricted
  if (isRestricted && !isArchived) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{cardContent}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-sm font-medium">{t('pages.motifs.card.restricted')}</p>
          <p className="text-xs text-foreground-muted mt-1">
            {restrictionReason || t('pages.motifs.card.restrictedTooltip')}
          </p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return cardContent
}
