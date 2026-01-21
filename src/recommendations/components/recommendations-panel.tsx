// src/recommendations/components/recommendations-panel.tsx
// Main container component for professional recommendations

import { motion } from 'framer-motion'
import { RefreshCw, Sparkles, AlertCircle, Clock } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'
import { useDemandeRecommendations } from '../hooks'
import { RecommendationCard } from './recommendation-card'
import { LoadingSkeleton } from './loading-skeleton'
import { ExclusionsSummary } from './exclusions-summary'
import { NearEligibleList } from './near-eligible-list'

export interface RecommendationsPanelProps {
  demandeId: string
  /** Callback when a professional is selected for assignment */
  onSelectProfessional?: (professionalId: string) => void
  /** Callback to view a professional's profile */
  onViewProfile?: (professionalId: string) => void
}

/**
 * Format processing time for display.
 */
function formatProcessingTime(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Format generation timestamp.
 */
function formatGeneratedAt(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleString('fr-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * AI summary section with extracted preferences.
 */
function AISummarySection({
  summary,
  preferences,
}: {
  summary: string | null
  preferences?: {
    preferredTiming?: string
    preferredModality?: string
    otherConstraints?: string[]
  } | null
}) {
  if (!summary) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-sage-200 bg-sage-50/50 p-4"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-sage-600 shrink-0 mt-0.5" />
        <div className="space-y-2 flex-1 min-w-0">
          <p className="text-sm text-foreground leading-relaxed">{summary}</p>

          {/* Extracted preferences */}
          {preferences && (preferences.preferredTiming || preferences.preferredModality) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {preferences.preferredTiming && (
                <span className="inline-flex items-center gap-1 text-xs text-sage-700 bg-sage-100 px-2 py-0.5 rounded-full">
                  <Clock className="h-3 w-3" />
                  {preferences.preferredTiming}
                </span>
              )}
              {preferences.preferredModality && (
                <span className="inline-flex items-center text-xs text-sage-700 bg-sage-100 px-2 py-0.5 rounded-full">
                  {preferences.preferredModality}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/**
 * Empty state when no recommendations exist yet.
 */
function EmptyState({
  onGenerate,
  isGenerating,
}: {
  onGenerate: () => void
  isGenerating: boolean
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background-secondary/30 p-8 text-center">
      <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-honey-50 flex items-center justify-center">
        <Sparkles className="h-6 w-6 text-honey-400" />
      </div>
      <p className="text-sm text-foreground-secondary leading-relaxed mb-2">
        {t('recommendations.empty.title')}
      </p>
      <p className="text-xs text-foreground-muted mb-4">
        {t('recommendations.empty.description')}
      </p>
      <Button onClick={onGenerate} disabled={isGenerating} size="sm">
        {isGenerating ? (
          <>
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            {t('recommendations.actions.generating')}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-2" />
            {t('recommendations.actions.generate')}
          </>
        )}
      </Button>
    </div>
  )
}

/**
 * Error state display.
 */
function ErrorState({
  error,
  onRetry,
}: {
  error: Error | null
  onRetry: () => void
}) {
  return (
    <div className="rounded-xl border border-wine-200 bg-wine-50/50 p-6 text-center">
      <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-wine-100 flex items-center justify-center">
        <AlertCircle className="h-5 w-5 text-wine-600" />
      </div>
      <p className="text-sm font-medium text-wine-700 mb-1">
        {t('recommendations.error.title')}
      </p>
      <p className="text-xs text-wine-600 mb-4">
        {error?.message || t('recommendations.error.generic')}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('recommendations.actions.retry')}
      </Button>
    </div>
  )
}

/**
 * Generation metadata footer.
 */
function GenerationMetadata({
  generatedAt,
  processingTimeMs,
  modelVersion,
}: {
  generatedAt: string
  processingTimeMs: number | null
  modelVersion: string | null
}) {
  return (
    <div className="flex items-center justify-between text-xs text-foreground-muted pt-3 border-t border-border/50">
      <span>
        {t('recommendations.metadata.generatedAt').replace('{{date}}', formatGeneratedAt(generatedAt))}
      </span>
      <div className="flex items-center gap-3">
        {processingTimeMs !== null && (
          <span>
            {t('recommendations.metadata.processingTime').replace('{{time}}', formatProcessingTime(processingTimeMs))}
          </span>
        )}
        {modelVersion && (
          <span className="font-mono">{modelVersion}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Main recommendations panel component.
 * Displays professional recommendations for a demande.
 */
export function RecommendationsPanel({
  demandeId,
  onSelectProfessional,
  onViewProfile,
}: RecommendationsPanelProps) {
  const {
    data,
    isLoading,
    error,
    generate,
    isGenerating,
    generateError,
  } = useDemandeRecommendations(demandeId)

  // Handle generate action
  const handleGenerate = async () => {
    try {
      await generate({ forceRegenerate: true })
    } catch {
      // Error is captured in generateError state
    }
  }

  // Loading state
  if (isLoading) {
    return <LoadingSkeleton />
  }

  // Error states
  if (error || generateError) {
    return <ErrorState error={error || generateError} onRetry={handleGenerate} />
  }

  // Empty state - no recommendations have ever been generated
  if (!data) {
    return <EmptyState onGenerate={handleGenerate} isGenerating={isGenerating} />
  }

  // Has data (even if 0 recommendations - show exclusions/near-eligible)
  const { recommendations, aiSummaryFr, aiExtractedPreferences, exclusions, nearEligible } = data
  const hasNoRecommendations = recommendations.length === 0

  return (
    <div className="space-y-4">
      {/* Refresh button */}
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="text-xs"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5 mr-1.5', isGenerating && 'animate-spin')}
          />
          {isGenerating
            ? t('recommendations.actions.refreshing')
            : t('recommendations.actions.refresh')}
        </Button>
      </div>

      {/* AI Summary */}
      <AISummarySection summary={aiSummaryFr} preferences={aiExtractedPreferences} />

      {/* No eligible professionals message */}
      {hasNoRecommendations && (
        <div className="rounded-lg border border-honey-200 bg-honey-50/50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-honey-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-honey-800">
                {t('recommendations.noEligible.title')}
              </p>
              <p className="text-xs text-honey-700">
                {t('recommendations.noEligible.description')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendation cards */}
      {recommendations.length > 0 && (
        <div className="space-y-3">
          {recommendations.slice(0, 3).map((rec, index) => (
            <RecommendationCard
              key={rec.id}
              recommendation={rec}
              rank={index + 1}
              onSelect={onSelectProfessional}
              onViewProfile={onViewProfile}
            />
          ))}
        </div>
      )}

      {/* Near-eligible section */}
      <NearEligibleList nearEligible={nearEligible} />

      {/* Exclusions summary */}
      <ExclusionsSummary exclusions={exclusions} />

      {/* Generation metadata */}
      <GenerationMetadata
        generatedAt={data.generatedAt}
        processingTimeMs={data.processingTimeMs}
        modelVersion={data.modelVersion}
      />
    </div>
  )
}
