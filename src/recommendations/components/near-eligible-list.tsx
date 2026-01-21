// src/recommendations/components/near-eligible-list.tsx
// List of professionals who almost qualified

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, AlertTriangle, Calendar } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import type { NearEligible, ExclusionReasonCode } from '../types'
import { ScoreBadge } from './score-breakdown'

interface NearEligibleListProps {
  nearEligible: NearEligible[]
  /** Initially expanded state */
  defaultExpanded?: boolean
}

interface NearEligibleItemProps {
  item: NearEligible
}

const CONSTRAINT_LABELS: Record<ExclusionReasonCode, string> = {
  no_availability: 'recommendations.nearEligible.constraints.noAvailability',
  no_motif_overlap: 'recommendations.nearEligible.constraints.noMotifOverlap',
  no_population_match: 'recommendations.nearEligible.constraints.noPopulationMatch',
  no_demand_type_specialty: 'recommendations.nearEligible.constraints.noDemandTypeSpecialty',
  inactive_status: 'recommendations.nearEligible.constraints.inactiveStatus',
}

/**
 * Format the next available date.
 */
function formatNextAvailable(isoDate?: string): string | null {
  if (!isoDate) return null

  const date = new Date(isoDate)
  return date.toLocaleDateString('fr-CA', {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format missing motifs for display.
 */
function formatMissingMotifs(details?: Record<string, unknown>): string[] {
  if (!details) return []
  const missingMotifs = details.missingMotifs as string[] | undefined
  return missingMotifs || []
}

/**
 * Single near-eligible professional item.
 */
function NearEligibleItem({ item }: NearEligibleItemProps) {
  const nextAvailable = formatNextAvailable(item.nextAvailableDate)
  const missingMotifs = formatMissingMotifs(item.details)

  return (
    <div className="py-3 border-b border-border/30 last:border-0">
      {/* Professional info */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {item.displayName || t('recommendations.nearEligible.unknownProfessional')}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="warning" className="text-xs">
              {t(CONSTRAINT_LABELS[item.missingConstraint] as Parameters<typeof t>[0])}
            </Badge>
            {item.missingConstraint === 'no_availability' && nextAvailable && (
              <span className="flex items-center gap-1 text-xs text-foreground-muted">
                <Calendar className="h-3 w-3" />
                {t('recommendations.nearEligible.nextAvailable').replace('{{date}}', nextAvailable)}
              </span>
            )}
          </div>
        </div>

        {/* Would-be score */}
        <div className="shrink-0 text-right">
          <span className="text-xs text-foreground-muted block mb-0.5">
            {t('recommendations.nearEligible.wouldBeScore')}
          </span>
          <ScoreBadge score={item.scores.totalScore} />
        </div>
      </div>

      {/* Detailed reason */}
      <p className="text-xs text-foreground-secondary mt-2 pl-0">
        {item.reasonFr}
      </p>

      {/* Missing motifs list if applicable */}
      {missingMotifs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-xs text-foreground-muted">{t('recommendations.nearEligible.missingMotifs')}:</span>
          {missingMotifs.map((motif) => (
            <span
              key={motif}
              className="text-xs bg-wine-50 text-wine-700 px-1.5 py-0.5 rounded border border-wine-200"
            >
              {motif}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Expandable list of near-eligible professionals.
 * Shows professionals who almost qualified but failed one constraint.
 */
export function NearEligibleList({
  nearEligible,
  defaultExpanded = false,
}: NearEligibleListProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (!nearEligible || nearEligible.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-dashed border-honey-200 bg-honey-50/30">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="w-full flex items-center justify-between p-4 hover:bg-honey-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-honey-600" />
          <span className="text-sm font-medium text-honey-700">
            {t('recommendations.nearEligible.title').replace('{{count}}', String(nearEligible.length))}
          </span>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-honey-600 transition-transform duration-200',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-honey-200/50">
              {/* Description */}
              <p className="text-xs text-foreground-muted py-2">
                {t('recommendations.nearEligible.description')}
              </p>

              {/* List */}
              <div className="mt-2">
                {nearEligible.slice(0, 5).map((item) => (
                  <NearEligibleItem
                    key={item.professionalId}
                    item={item}
                  />
                ))}
                {nearEligible.length > 5 && (
                  <p className="text-xs text-foreground-muted pt-2 text-center">
                    {t('recommendations.nearEligible.andMore').replace('{{count}}', String(nearEligible.length - 5))}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
