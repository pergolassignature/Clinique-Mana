import { useState, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Info, X, Plus, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { LockedPopover } from './locked-popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/ui/command'
import {
  MOTIF_DISPLAY_GROUPS,
  isOtherMotif,
  useMotifs,
  type Motif,
} from '@/motifs'

interface MotifPickerProps {
  selected: string[]
  onChange: (motifs: string[]) => void
  description?: string
  onDescriptionChange?: (text: string) => void
  otherText?: string
  onOtherTextChange?: (text: string) => void
  readOnly?: boolean
  variant?: 'default' | 'compact'
  helperText?: string
  restrictedMotifs?: string[]
  onRestrictedClick?: (key: string) => void
  showGuidance?: boolean
  className?: string
}

export function MotifPicker({
  selected,
  onChange,
  description = '',
  onDescriptionChange,
  otherText = '',
  onOtherTextChange,
  readOnly = false,
  variant = 'default',
  helperText,
  restrictedMotifs = [],
  onRestrictedClick,
  showGuidance = true,
  className,
}: MotifPickerProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  // Fetch motifs from database
  const { motifs: dbMotifs, isLoading } = useMotifs()

  // Transform database motifs to UI motifs
  const allMotifs: Motif[] = useMemo(() => {
    return dbMotifs.map((dbMotif) => ({
      key: dbMotif.key,
      label: dbMotif.label,
      isRestricted: dbMotif.is_restricted,
    }))
  }, [dbMotifs])

  // Create a map of motif key -> motif for quick lookup
  const motifMap = useMemo(() => {
    return new Map(allMotifs.map((m) => [m.key, m]))
  }, [allMotifs])

  // Build grouped structure for picker display
  const groupedMotifs = useMemo(() => {
    const groups = MOTIF_DISPLAY_GROUPS.map((group) => ({
      ...group,
      motifs: group.motifKeys
        .map((key) => motifMap.get(key))
        .filter((m): m is Motif => m !== undefined),
    })).filter((group) => group.motifs.length > 0)

    // Find ungrouped motifs
    const groupedKeys = new Set(MOTIF_DISPLAY_GROUPS.flatMap((g) => g.motifKeys))
    const ungroupedMotifs = allMotifs.filter((m) => !groupedKeys.has(m.key))

    if (ungroupedMotifs.length > 0) {
      groups.push({
        labelKey: 'pages.motifs.groups.other',
        motifKeys: ungroupedMotifs.map((m) => m.key),
        motifs: ungroupedMotifs,
      })
    }

    return groups
  }, [allMotifs, motifMap])

  // Check if "other" motif is selected
  const hasOtherSelected = selected.some(isOtherMotif)

  // Get label for a motif (from database)
  const getMotifLabel = (key: string) => {
    return motifMap.get(key)?.label || key
  }

  // Check if a motif is restricted (from props or database)
  const checkIsRestricted = (key: string) =>
    restrictedMotifs.includes(key) || (motifMap.get(key)?.isRestricted ?? false)

  // Toggle motif selection
  const toggleMotif = (key: string) => {
    if (readOnly) return

    // Handle restricted motifs
    if (checkIsRestricted(key)) {
      onRestrictedClick?.(key)
      return
    }

    if (selected.includes(key)) {
      onChange(selected.filter((m) => m !== key))
    } else {
      onChange([...selected, key])
    }
  }

  // Remove a motif
  const removeMotif = (key: string) => {
    if (readOnly) return
    onChange(selected.filter((m) => m !== key))
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Section header with guidance tooltip */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
          {t('pages.motifs.picker.label')}
        </span>
        {showGuidance && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-foreground-muted hover:text-foreground-secondary transition-colors"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              {helperText || t('pages.motifs.picker.guidance')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Selected motifs as tags + Add button */}
      <div className="flex flex-wrap items-center gap-2">
        <AnimatePresence mode="popLayout">
          {selected.map((key) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
            >
              <Badge
                variant="default"
                className={cn(
                  'gap-1.5 text-sm',
                  variant === 'compact' ? 'text-xs px-2 py-0.5' : 'pr-1.5',
                  !readOnly && 'cursor-pointer hover:bg-sage-200'
                )}
              >
                {getMotifLabel(key)}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => removeMotif(key)}
                    className="rounded-full p-0.5 hover:bg-sage-300 transition-colors"
                  >
                    <X className={cn('text-sage-700', variant === 'compact' ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
                  </button>
                )}
              </Badge>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Add motif button with locked popover (position-locked while open) */}
        {!readOnly && (
          <>
            <Button
              ref={anchorRef}
              variant="outline"
              size="sm"
              onClick={() => setPopoverOpen(!popoverOpen)}
              className={cn(
                'gap-1.5 border-dashed border-sage-300 text-sage-600 hover:bg-sage-50 hover:text-sage-700 hover:border-sage-400 min-w-[140px]',
                variant === 'compact' ? 'h-6 text-xs' : 'h-7 text-sm'
              )}
            >
              <Plus className={cn(variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
              {t('pages.motifs.picker.addButton')}
            </Button>
            <LockedPopover
              anchorRef={anchorRef}
              open={popoverOpen}
              onOpenChange={setPopoverOpen}
              width={320}
              offset={8}
            >
              <Command>
                <CommandInput placeholder={t('pages.motifs.picker.searchPlaceholder')} />
                <CommandList className="max-h-[320px]">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-sage-500" />
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>{t('pages.motifs.picker.noResults')}</CommandEmpty>
                      {groupedMotifs.map((group) => (
                        <CommandGroup
                          key={group.labelKey}
                          heading={t(group.labelKey as Parameters<typeof t>[0])}
                        >
                          {group.motifs.map((motif) => {
                            const isSelected = selected.includes(motif.key)
                            const isRestricted = checkIsRestricted(motif.key)
                            return (
                              <CommandItem
                                key={motif.key}
                                value={motif.label}
                                onSelect={() => toggleMotif(motif.key)}
                                disabled={isRestricted}
                                className={cn(
                                  'flex items-start gap-3 py-2',
                                  isRestricted && 'opacity-50'
                                )}
                              >
                                {/* Checkbox indicator */}
                                <div
                                  className={cn(
                                    'mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                    isSelected
                                      ? 'bg-sage-500 border-sage-500'
                                      : 'border-border bg-background'
                                  )}
                                >
                                  {isSelected && <Check className="h-3 w-3 text-white" />}
                                </div>

                                {/* Label */}
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={cn(
                                      'text-sm font-medium leading-tight',
                                      isSelected ? 'text-sage-700' : 'text-foreground',
                                      isRestricted && 'text-foreground-muted'
                                    )}
                                  >
                                    {motif.label}
                                  </p>
                                </div>
                              </CommandItem>
                            )
                          })}
                        </CommandGroup>
                      ))}
                    </>
                  )}
                </CommandList>
                {/* Done button for explicit close */}
                <div className="border-t border-border p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-sm"
                    onClick={() => setPopoverOpen(false)}
                  >
                    {t('pages.motifs.picker.doneButton')}
                  </Button>
                </div>
              </Command>
            </LockedPopover>
          </>
        )}

        {/* Empty state when read-only and no motifs */}
        {readOnly && selected.length === 0 && (
          <p className="text-sm text-foreground-muted italic">
            {t('pages.motifs.picker.placeholder')}
          </p>
        )}
      </div>

      {/* "Other" text field - only shown when "Autre" motif is selected */}
      <AnimatePresence>
        {hasOtherSelected && onOtherTextChange && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-1.5"
          >
            <label className="text-xs font-medium text-foreground-muted">
              {t('pages.motifs.picker.otherInput.label')}
            </label>
            <input
              type="text"
              value={otherText}
              onChange={(e) => onOtherTextChange(e.target.value)}
              placeholder={t('pages.motifs.picker.otherInput.placeholder')}
              disabled={readOnly}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-sage-500/30 focus:border-sage-300 disabled:opacity-50"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Optional description field */}
      {onDescriptionChange && (
        <div className="space-y-2 pt-2">
          <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
            {t('pages.motifs.picker.description.label')}
          </label>
          <Textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={t('pages.motifs.picker.description.placeholder')}
            disabled={readOnly}
            className="min-h-[80px]"
          />
          <p className="text-xs text-foreground-muted">
            {t('pages.motifs.picker.description.helper')}
          </p>
        </div>
      )}
    </div>
  )
}
