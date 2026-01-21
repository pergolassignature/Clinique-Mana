// src/recommendations/components/score-breakdown.tsx
// Detailed score visualization component

import { t } from '@/i18n'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/ui/tooltip'
import { cn } from '@/shared/lib/utils'
import type { RecommendationProfessionalDetail } from '../types'

interface ScoreBreakdownProps {
  recommendation: RecommendationProfessionalDetail
  /** Display mode: 'inline' for hover tooltip, 'expanded' for full display */
  mode?: 'inline' | 'expanded'
}

interface ScoreItemProps {
  labelKey: string
  score: number
  colorClass: string
}

const SCORE_COMPONENTS = [
  { key: 'motifMatchScore', colorClass: 'bg-sage-500' },
  { key: 'specialtyMatchScore', colorClass: 'bg-honey-500' },
  { key: 'availabilityScore', colorClass: 'bg-sky-500' },
  { key: 'professionFitScore', colorClass: 'bg-violet-500' },
  { key: 'experienceScore', colorClass: 'bg-rose-400' },
] as const

function ScoreItem({ labelKey, score, colorClass }: ScoreItemProps) {
  const percentage = Math.round(score * 100)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground-secondary">
          {t(`recommendations.scores.${labelKey}` as Parameters<typeof t>[0])}
        </span>
        <span className="font-medium tabular-nums">{percentage}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-background-tertiary overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', colorClass)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

function ScoreBreakdownContent({
  recommendation,
}: {
  recommendation: RecommendationProfessionalDetail
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <span className="text-xs font-medium text-foreground">
          {t('recommendations.scores.title')}
        </span>
        <span className="text-sm font-semibold text-sage-600">
          {Math.round(recommendation.totalScore * 100)}%
        </span>
      </div>

      <div className="space-y-2.5">
        {SCORE_COMPONENTS.map(({ key, colorClass }) => (
          <ScoreItem
            key={key}
            labelKey={key}
            score={recommendation[key]}
            colorClass={colorClass}
          />
        ))}
      </div>

      {recommendation.aiRankingAdjustment !== null &&
        recommendation.aiRankingAdjustment !== 0 && (
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground-secondary">
                {t('recommendations.scores.aiAdjustment')}
              </span>
              <span
                className={cn(
                  'font-medium',
                  recommendation.aiRankingAdjustment > 0
                    ? 'text-sage-600'
                    : 'text-wine-600'
                )}
              >
                {recommendation.aiRankingAdjustment > 0 ? '+' : ''}
                {recommendation.aiRankingAdjustment}
              </span>
            </div>
          </div>
        )}
    </div>
  )
}

/**
 * Score breakdown component with visual bars.
 * Can be displayed inline (hover tooltip) or expanded.
 */
export function ScoreBreakdown({ recommendation, mode = 'inline' }: ScoreBreakdownProps) {
  const totalPercentage = Math.round(recommendation.totalScore * 100)

  if (mode === 'expanded') {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <ScoreBreakdownContent recommendation={recommendation} />
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('recommendations.scores.title')}
            className="inline-flex items-center gap-1.5 rounded-full bg-sage-100 px-2.5 py-1 text-sm font-semibold text-sage-700 hover:bg-sage-200 transition-colors cursor-help"
          >
            <span className="tabular-nums">{totalPercentage}%</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          align="start"
          className="w-64 p-0 bg-background border border-border shadow-medium"
        >
          <div className="p-3">
            <ScoreBreakdownContent recommendation={recommendation} />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Compact inline score badge without tooltip.
 * For use in lists or condensed views.
 */
export function ScoreBadge({
  score,
  className,
}: {
  score: number
  className?: string
}) {
  const percentage = Math.round(score * 100)

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-sage-100 px-2 py-0.5 text-xs font-semibold text-sage-700 tabular-nums',
        className
      )}
    >
      {percentage}%
    </span>
  )
}
