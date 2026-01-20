import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { MotifCard } from './motif-card'
import type { Motif } from '../types'

interface MotifCategoryGroupProps<T extends Motif = Motif> {
  categoryLabel: string
  motifs: T[]
  collapsible?: boolean
  defaultExpanded?: boolean
  selectedMotifs?: string[]
  onMotifSelect?: (key: string) => void
  /** Custom render function for motif cards */
  renderCard?: (motif: T) => React.ReactNode
  className?: string
}

export function MotifCategoryGroup<T extends Motif = Motif>({
  categoryLabel,
  motifs,
  collapsible = false,
  defaultExpanded = true,
  selectedMotifs = [],
  onMotifSelect,
  renderCard,
  className,
}: MotifCategoryGroupProps<T>) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (motifs.length === 0) {
    return null
  }

  const toggleExpanded = () => {
    if (collapsible) {
      setIsExpanded(!isExpanded)
    }
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Category Header */}
      <button
        type="button"
        onClick={toggleExpanded}
        disabled={!collapsible}
        className={cn(
          'flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-foreground-muted',
          collapsible && 'cursor-pointer hover:text-foreground-secondary transition-colors'
        )}
      >
        {collapsible && (
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-200',
              !isExpanded && '-rotate-90'
            )}
          />
        )}
        <span>{categoryLabel}</span>
        <span className="text-foreground-muted/60">({motifs.length})</span>
      </button>

      {/* Motif Cards Grid */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={collapsible ? { height: 0, opacity: 0 } : undefined}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {motifs.map((motif) =>
                renderCard ? (
                  renderCard(motif)
                ) : (
                  <MotifCard
                    key={motif.key}
                    motifKey={motif.key}
                    label={motif.label}
                    isRestricted={motif.isRestricted}
                    isActive={motif.isActive}
                    isSelected={selectedMotifs.includes(motif.key)}
                    onSelect={onMotifSelect ? () => onMotifSelect(motif.key) : undefined}
                  />
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
