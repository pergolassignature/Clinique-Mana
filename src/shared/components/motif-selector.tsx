import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Info, X, Plus } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/ui/command'

// Motif keys that map to i18n translations
const MOTIF_KEYS = [
  'anxiety',
  'stress',
  'burnout',
  'relationships',
  'emotions',
  'parenting',
  'selfExploration',
  'lifeTransition',
  'workSupport',
  'grief',
  'selfEsteem',
  'other',
] as const

type MotifKey = (typeof MOTIF_KEYS)[number]

// Category groupings for faster scanning (visual only, not stored)
const MOTIF_CATEGORIES: { label: string; motifs: MotifKey[] }[] = [
  {
    label: 'Anxiété & stress',
    motifs: ['anxiety', 'stress', 'burnout'],
  },
  {
    label: 'Relations',
    motifs: ['relationships', 'parenting'],
  },
  {
    label: 'Émotions',
    motifs: ['emotions', 'selfEsteem'],
  },
  {
    label: 'Vie personnelle',
    motifs: ['selfExploration', 'lifeTransition', 'grief'],
  },
  {
    label: 'Travail',
    motifs: ['workSupport'],
  },
  {
    label: 'Autre',
    motifs: ['other'],
  },
]

interface MotifSelectorProps {
  selectedMotifs: MotifKey[]
  onMotifsChange: (motifs: MotifKey[]) => void
  description: string
  onDescriptionChange: (description: string) => void
  otherText?: string
  onOtherTextChange?: (text: string) => void
  readOnly?: boolean
}

export function MotifSelector({
  selectedMotifs,
  onMotifsChange,
  description,
  onDescriptionChange,
  otherText = '',
  onOtherTextChange,
  readOnly = false,
}: MotifSelectorProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)

  const toggleMotif = (key: MotifKey) => {
    if (readOnly) return
    if (selectedMotifs.includes(key)) {
      onMotifsChange(selectedMotifs.filter((m) => m !== key))
    } else {
      onMotifsChange([...selectedMotifs, key])
    }
  }

  const removeMotif = (key: MotifKey) => {
    if (readOnly) return
    onMotifsChange(selectedMotifs.filter((m) => m !== key))
  }

  const getMotifLabel = (key: MotifKey) =>
    t(`pages.requestDetail.motifs.list.${key}.label` as Parameters<typeof t>[0])

  const getMotifDescription = (key: MotifKey) =>
    t(`pages.requestDetail.motifs.list.${key}.description` as Parameters<typeof t>[0])

  return (
    <div className="space-y-4">
      {/* Section header with guidance tooltip */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
          {t('pages.requestDetail.motifs.label')}
        </span>
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
            {t('pages.requestDetail.motifs.guidance')}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Selected motifs as tags + Add button */}
      <div className="flex flex-wrap items-center gap-2">
        <AnimatePresence mode="popLayout">
          {selectedMotifs.map((key) => (
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
                  'gap-1.5 pr-1.5 text-sm',
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
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Add motif button with popover */}
        {!readOnly && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-sm border-dashed border-sage-300 text-sage-600 hover:bg-sage-50 hover:text-sage-700 hover:border-sage-400"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('pages.requestDetail.motifs.addButton')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <Command>
                <CommandInput
                  placeholder={t('pages.requestDetail.motifs.searchPlaceholder')}
                />
                <CommandList>
                  <CommandEmpty>
                    {t('pages.requestDetail.motifs.noResults')}
                  </CommandEmpty>
                  {MOTIF_CATEGORIES.map((category) => (
                    <CommandGroup key={category.label} heading={category.label}>
                      {category.motifs.map((key) => {
                        const isSelected = selectedMotifs.includes(key)
                        return (
                          <CommandItem
                            key={key}
                            value={getMotifLabel(key)}
                            onSelect={() => toggleMotif(key)}
                            className="flex items-start gap-3 py-2"
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
                              {isSelected && (
                                <Check className="h-3 w-3 text-white" />
                              )}
                            </div>

                            {/* Label and description */}
                            <div className="flex-1 min-w-0">
                              <p
                                className={cn(
                                  'text-sm font-medium leading-tight',
                                  isSelected ? 'text-sage-700' : 'text-foreground'
                                )}
                              >
                                {getMotifLabel(key)}
                              </p>
                              <p className="text-xs text-foreground-muted mt-0.5 line-clamp-1">
                                {getMotifDescription(key)}
                              </p>
                            </div>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}

        {/* Empty state when read-only and no motifs */}
        {readOnly && selectedMotifs.length === 0 && (
          <p className="text-sm text-foreground-muted italic">
            {t('pages.requestDetail.motifs.placeholder')}
          </p>
        )}
      </div>

      {/* "Other" text field when selected */}
      <AnimatePresence>
        {selectedMotifs.includes('other') && onOtherTextChange && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-1.5"
          >
            <label className="text-xs font-medium text-foreground-muted">
              {t('pages.requestDetail.motifs.otherInput.label')}
            </label>
            <input
              type="text"
              value={otherText}
              onChange={(e) => onOtherTextChange(e.target.value)}
              placeholder={t('pages.requestDetail.motifs.otherInput.placeholder')}
              disabled={readOnly}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-sage-500/30 focus:border-sage-300 disabled:opacity-50"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Optional description field */}
      <div className="space-y-2 pt-2">
        <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
          {t('pages.requestDetail.motifs.description.label')}
        </label>
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder={t('pages.requestDetail.motifs.description.placeholder')}
          disabled={readOnly}
          className="min-h-[80px]"
        />
        <p className="text-xs text-foreground-muted">
          {t('pages.requestDetail.motifs.description.helper')}
        </p>
      </div>
    </div>
  )
}

export { MOTIF_KEYS }
export type { MotifKey }
