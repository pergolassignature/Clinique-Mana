// src/recommendations/components/exclusions-summary.tsx
// Collapsible summary of excluded professionals

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, AlertCircle, Calendar, Target, Users, UserX } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import type { ExclusionRecord, ExclusionReasonCode } from '../types'

interface ExclusionsSummaryProps {
  exclusions: ExclusionRecord[]
  /** Initially expanded state */
  defaultExpanded?: boolean
}

interface ExclusionGroup {
  reasonCode: ExclusionReasonCode
  count: number
  items: ExclusionRecord[]
}

const EXCLUSION_ICONS: Record<ExclusionReasonCode, typeof AlertCircle> = {
  no_availability: Calendar,
  no_motif_overlap: Target,
  no_clientele_match: Users,
  no_demand_type_specialty: Users,
  inactive_status: UserX,
}

const EXCLUSION_COLORS: Record<ExclusionReasonCode, string> = {
  no_availability: 'text-honey-600',
  no_motif_overlap: 'text-wine-600',
  no_clientele_match: 'text-violet-600',
  no_demand_type_specialty: 'text-violet-600',
  inactive_status: 'text-foreground-muted',
}

/**
 * Group exclusions by reason code.
 */
function groupExclusions(exclusions: ExclusionRecord[]): ExclusionGroup[] {
  const groups = new Map<ExclusionReasonCode, ExclusionRecord[]>()

  for (const exclusion of exclusions) {
    const existing = groups.get(exclusion.reasonCode) || []
    groups.set(exclusion.reasonCode, [...existing, exclusion])
  }

  return Array.from(groups.entries()).map(([reasonCode, items]) => ({
    reasonCode,
    count: items.length,
    items,
  }))
}

/**
 * Single exclusion reason row.
 */
function ExclusionReasonRow({ group }: { group: ExclusionGroup }) {
  const Icon = EXCLUSION_ICONS[group.reasonCode] || AlertCircle
  const colorClass = EXCLUSION_COLORS[group.reasonCode] || 'text-foreground-muted'

  return (
    <div className="flex items-center gap-3 py-2">
      <Icon className={cn('h-4 w-4 shrink-0', colorClass)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground-secondary">
          {t(`recommendations.exclusions.reasons.${group.reasonCode}` as Parameters<typeof t>[0])}
        </p>
      </div>
      <span className="text-sm font-medium text-foreground-muted tabular-nums">
        {group.count}
      </span>
    </div>
  )
}

/**
 * Collapsible summary of excluded professionals.
 * Shows counts by exclusion reason with expandable details.
 */
export function ExclusionsSummary({
  exclusions,
  defaultExpanded = false,
}: ExclusionsSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (!exclusions || exclusions.length === 0) {
    return null
  }

  const groups = groupExclusions(exclusions)
  const totalExcluded = exclusions.length

  return (
    <div className="rounded-lg border border-dashed border-border bg-background-secondary/30">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="w-full flex items-center justify-between p-4 hover:bg-background-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-foreground-muted" />
          <span className="text-sm text-foreground-secondary">
            {t('recommendations.exclusions.title').replace('{{count}}', String(totalExcluded))}
          </span>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-foreground-muted transition-transform duration-200',
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
            <div className="px-4 pb-4 border-t border-border/50">
              <div className="divide-y divide-border/30">
                {groups.map((group) => (
                  <ExclusionReasonRow key={group.reasonCode} group={group} />
                ))}
              </div>

              {/* Helper text */}
              <p className="mt-3 text-xs text-foreground-muted">
                {t('recommendations.exclusions.helper')}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
