// src/recommendations/components/recommendation-card.tsx
// Individual recommendation card component

import { motion } from 'framer-motion'
import { Calendar, ChevronRight, User } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { cn } from '@/shared/lib/utils'
import type { RecommendationProfessionalDetail } from '../types'
import { ScoreBreakdown } from './score-breakdown'
import type { MotifKey } from '@/shared/components/motif-selector'

export interface RecommendationCardProps {
  recommendation: RecommendationProfessionalDetail
  rank: number
  onSelect?: (professionalId: string, displayName: string) => void
  onViewProfile?: (professionalId: string) => void
}

/**
 * Get initials from a display name.
 */
function getInitials(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2 && parts[0] && parts[parts.length - 1]) {
    const first = parts[0][0] ?? ''
    const last = parts[parts.length - 1]?.[0] ?? ''
    return `${first}${last}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

/**
 * Format a date for display.
 */
function formatNextSlot(isoDate: string | null): string {
  if (!isoDate) return t('recommendations.card.noAvailability')

  const date = new Date(isoDate)
  const now = new Date()
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return t('recommendations.card.availableToday')
  } else if (diffDays === 1) {
    return t('recommendations.card.availableTomorrow')
  } else if (diffDays <= 7) {
    // Replace {{days}} placeholder manually
    return t('recommendations.card.availableInDays').replace('{{days}}', String(diffDays))
  } else {
    return date.toLocaleDateString('fr-CA', {
      month: 'short',
      day: 'numeric',
    })
  }
}

/**
 * Get motif label from translation.
 */
function getMotifLabel(key: string): string {
  return t(`pages.requestDetail.motifs.list.${key as MotifKey}.label` as Parameters<typeof t>[0])
}

/**
 * Rank badge with position indicator.
 */
function RankBadge({ rank }: { rank: number }) {
  const rankStyles = {
    1: 'bg-honey-100 text-honey-700 border-honey-200',
    2: 'bg-background-tertiary text-foreground-secondary border-border',
    3: 'bg-background-secondary text-foreground-muted border-border',
  }

  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold',
        rankStyles[rank as keyof typeof rankStyles] ?? rankStyles[3]
      )}
    >
      {rank}
    </div>
  )
}

/**
 * Individual recommendation card component.
 * Displays professional details, scores, AI reasoning, and actions.
 */
export function RecommendationCard({
  recommendation,
  rank,
  onSelect,
  onViewProfile,
}: RecommendationCardProps) {
  const {
    professionalId,
    displayName,
    professionTitles,
    aiReasoningBullets,
    matchedMotifs,
    nextAvailableSlot,
    availableSlotsCount,
  } = recommendation

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05 }}
      className="rounded-xl border border-border bg-background p-4 hover:border-sage-200 hover:shadow-soft transition-all"
    >
      <div className="flex items-start gap-4">
        {/* Rank badge */}
        <RankBadge rank={rank} />

        {/* Avatar */}
        <Avatar className="h-12 w-12 shrink-0">
          <AvatarFallback className="text-base">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header: Name, titles, and score */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-semibold text-foreground truncate">
                {displayName || t('recommendations.card.unknownProfessional')}
              </h4>
              {professionTitles && professionTitles.length > 0 && (
                <p className="text-xs text-foreground-muted truncate">
                  {professionTitles.join(' / ')}
                </p>
              )}
            </div>
            <ScoreBreakdown recommendation={recommendation} mode="inline" />
          </div>

          {/* AI reasoning bullets */}
          {aiReasoningBullets && aiReasoningBullets.length > 0 && (
            <ul className="mt-2 space-y-1">
              {aiReasoningBullets.slice(0, 3).map((bullet, index) => (
                <li
                  key={index}
                  className="text-xs text-foreground-secondary leading-relaxed flex items-start gap-1.5"
                >
                  <span className="text-sage-400 shrink-0">-</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Matched motifs */}
          {matchedMotifs && matchedMotifs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {matchedMotifs.slice(0, 4).map((motif) => (
                <Badge key={motif} variant="default" className="text-xs">
                  {getMotifLabel(motif)}
                </Badge>
              ))}
              {matchedMotifs.length > 4 && (
                <Badge variant="secondary" className="text-xs">
                  +{matchedMotifs.length - 4}
                </Badge>
              )}
            </div>
          )}

          {/* Availability and actions */}
          <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/50">
            {/* Availability info */}
            <div className="flex items-center gap-2 text-xs text-foreground-secondary">
              <Calendar className="h-3.5 w-3.5" />
              <span>
                {formatNextSlot(nextAvailableSlot)}
                {availableSlotsCount > 0 && (
                  <span className="text-foreground-muted ml-1">
                    ({availableSlotsCount} {t('recommendations.card.slotsAvailable')})
                  </span>
                )}
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => onViewProfile?.(professionalId)}
              >
                <User className="h-3.5 w-3.5 mr-1" />
                {t('recommendations.card.viewProfile')}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="text-xs h-8"
                onClick={() => onSelect?.(professionalId, displayName || 'Professionnel')}
              >
                {t('recommendations.card.select')}
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
