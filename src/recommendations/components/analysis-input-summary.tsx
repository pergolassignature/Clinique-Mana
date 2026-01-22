// src/recommendations/components/analysis-input-summary.tsx
// Shows what data was used for the recommendation analysis

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, FileSearch, Tag, Users, Calendar, Scale, Clock, Video, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'

interface ProfessionEligibilityRule {
  professionKey: string
  labelFr: string
  isEligible: boolean
  reason: string
  priority: 'preferred' | 'eligible' | 'not_recommended'
}

interface AnalysisInputSummaryProps {
  inputSnapshot: Record<string, unknown>
  aiExtractedPreferences?: {
    preferredTiming?: string
    preferredModality?: string
    otherConstraints?: string[]
  } | null
  candidateCount: number
  exclusionCount: number
}

/**
 * Map demand type key to French label.
 */
function getDemandTypeLabel(type: string | null | undefined): string {
  const labels: Record<string, string> = {
    individual: 'Individuelle',
    couple: 'Couple',
    family: 'Familiale',
    group: 'Groupe',
  }
  return type ? labels[type] || type : 'Non spécifié'
}

/**
 * Map urgency level to French label with color.
 */
function getUrgencyInfo(level: string | null | undefined): { label: string; colorClass: string } {
  const info: Record<string, { label: string; colorClass: string }> = {
    low: { label: 'Faible', colorClass: 'bg-sage-100 text-sage-700' },
    moderate: { label: 'Modéré', colorClass: 'bg-honey-100 text-honey-700' },
    high: { label: 'Élevé', colorClass: 'bg-wine-100 text-wine-700' },
  }
  return level ? info[level] || { label: level, colorClass: 'bg-background-secondary text-foreground-secondary' } : { label: 'Non spécifié', colorClass: 'bg-background-secondary text-foreground-secondary' }
}

/**
 * Map clientele category to French label.
 */
function getClienteleLabel(category: string): string {
  const labels: Record<string, string> = {
    children: 'Enfants',
    adolescents: 'Adolescents',
    adults: 'Adultes',
    seniors: 'Aînés',
  }
  return labels[category] || category
}

/**
 * Shows a summary of what data was analyzed for recommendations.
 * Helps users understand what the system looked at.
 */
export function AnalysisInputSummary({
  inputSnapshot,
  aiExtractedPreferences,
  candidateCount,
  exclusionCount,
}: AnalysisInputSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const demandType = inputSnapshot.demandType as string | null
  const urgencyLevel = inputSnapshot.urgencyLevel as string | null
  const motifKeys = (inputSnapshot.motifKeys as string[]) || []
  const clienteleCategories = (inputSnapshot.clienteleCategories as string[]) || []
  const hasLegalContext = inputSnapshot.hasLegalContext as boolean
  const professionRules = (inputSnapshot.professionRules as ProfessionEligibilityRule[]) || []
  const urgencyInfo = getUrgencyInfo(urgencyLevel)

  // Extract match result statistics from inputSnapshot
  const matchResult = inputSnapshot.matchResult as {
    totalEvaluated?: number
    filteredByClientele?: number
    filteredByAvailability?: number
  } | undefined

  // Total professionals analyzed (before any filters)
  const totalProfessionals = (inputSnapshot.totalProfessionalsAnalyzed as number)
    || matchResult?.totalEvaluated
    || (candidateCount + exclusionCount)

  // Eligible = total - filtered by clientele - filtered by availability
  const filteredByClientele = matchResult?.filteredByClientele || 0
  const filteredByAvailability = matchResult?.filteredByAvailability || 0
  const eligibleCount = matchResult?.totalEvaluated
    ? matchResult.totalEvaluated - filteredByClientele - filteredByAvailability
    : candidateCount

  return (
    <div className="rounded-lg border border-border bg-background">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="w-full flex items-center justify-between p-4 hover:bg-background-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-sage-600" />
          <span className="text-sm font-medium text-foreground">
            {t('recommendations.analysisInput.title')}
          </span>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-foreground-muted transition-transform',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* Request Analysis */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  {t('recommendations.analysisInput.requestDetails')}
                </p>

                {/* Type and Urgency row */}
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-foreground-muted" />
                    <span className="text-sm text-foreground-secondary">
                      {t('recommendations.analysisInput.demandType')}:
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {getDemandTypeLabel(demandType)}
                    </span>
                  </div>

                  {urgencyLevel && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-foreground-muted" />
                      <span className="text-sm text-foreground-secondary">
                        {t('recommendations.analysisInput.urgency')}:
                      </span>
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', urgencyInfo.colorClass)}>
                        {urgencyInfo.label}
                      </span>
                    </div>
                  )}

                  {hasLegalContext && (
                    <div className="flex items-center gap-2">
                      <Scale className="h-3.5 w-3.5 text-foreground-muted" />
                      <span className="text-xs font-medium text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full">
                        {t('recommendations.analysisInput.legalContext')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Motifs */}
                {motifKeys.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Tag className="h-3.5 w-3.5 text-foreground-muted" />
                      <span className="text-sm text-foreground-secondary">
                        {t('recommendations.analysisInput.motifs')} ({motifKeys.length}):
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-5">
                      {motifKeys.map((motif) => (
                        <span
                          key={motif}
                          className="text-xs bg-sage-50 text-sage-700 px-2 py-0.5 rounded border border-sage-200"
                        >
                          {motif}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clientele Categories */}
                {clienteleCategories.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Users className="h-3.5 w-3.5 text-foreground-muted" />
                    <span className="text-sm text-foreground-secondary">
                      {t('recommendations.analysisInput.clientele')}:
                    </span>
                    {clienteleCategories.map((cat) => (
                      <span
                        key={cat}
                        className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded border border-violet-200"
                      >
                        {getClienteleLabel(cat)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Extracted Preferences (if any) */}
              {aiExtractedPreferences && (aiExtractedPreferences.preferredTiming || aiExtractedPreferences.preferredModality || (aiExtractedPreferences.otherConstraints && aiExtractedPreferences.otherConstraints.length > 0)) && (
                <div className="space-y-3 pt-3 border-t border-border">
                  <p className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                    {t('recommendations.analysisInput.aiExtracted')}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {aiExtractedPreferences.preferredTiming && (
                      <div className="flex items-center gap-1.5 text-xs bg-sage-50 text-sage-700 px-2.5 py-1 rounded-full border border-sage-200">
                        <Clock className="h-3 w-3" />
                        {aiExtractedPreferences.preferredTiming}
                      </div>
                    )}
                    {aiExtractedPreferences.preferredModality && (
                      <div className="flex items-center gap-1.5 text-xs bg-sage-50 text-sage-700 px-2.5 py-1 rounded-full border border-sage-200">
                        <Video className="h-3 w-3" />
                        {aiExtractedPreferences.preferredModality}
                      </div>
                    )}
                    {aiExtractedPreferences.otherConstraints?.map((constraint, i) => (
                      <span
                        key={i}
                        className="text-xs bg-background-secondary text-foreground-secondary px-2.5 py-1 rounded-full border border-border"
                      >
                        {constraint}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Profession Eligibility Rules */}
              {professionRules.length > 0 && (
                <div className="space-y-3 pt-3 border-t border-border">
                  <p className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                    {t('recommendations.analysisInput.professionEligibility')}
                  </p>

                  <div className="space-y-2">
                    {/* Preferred professions */}
                    {professionRules.filter(r => r.priority === 'preferred').length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-sage-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="font-medium">{t('recommendations.analysisInput.professionPreferred')}</span>
                        </div>
                        <div className="pl-5 space-y-1">
                          {professionRules.filter(r => r.priority === 'preferred').map((rule) => (
                            <div key={rule.professionKey} className="flex items-start gap-2">
                              <span className="text-sm font-medium text-foreground bg-sage-50 px-2 py-0.5 rounded border border-sage-200">
                                {rule.labelFr}
                              </span>
                              <span className="text-xs text-foreground-secondary pt-0.5">{rule.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Eligible professions */}
                    {professionRules.filter(r => r.priority === 'eligible').length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-sky-700">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span className="font-medium">{t('recommendations.analysisInput.professionEligibleLabel')}</span>
                        </div>
                        <div className="pl-5 space-y-1">
                          {professionRules.filter(r => r.priority === 'eligible').map((rule) => (
                            <div key={rule.professionKey} className="flex items-start gap-2">
                              <span className="text-sm font-medium text-foreground bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                                {rule.labelFr}
                              </span>
                              <span className="text-xs text-foreground-secondary pt-0.5">{rule.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Not recommended professions */}
                    {professionRules.filter(r => r.priority === 'not_recommended').length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-foreground-muted">
                          <XCircle className="h-3.5 w-3.5" />
                          <span className="font-medium">{t('recommendations.analysisInput.professionNotRecommended')}</span>
                        </div>
                        <div className="pl-5 space-y-1">
                          {professionRules.filter(r => r.priority === 'not_recommended').map((rule) => (
                            <div key={rule.professionKey} className="flex items-start gap-2">
                              <span className="text-sm text-foreground-muted bg-background-secondary px-2 py-0.5 rounded border border-border">
                                {rule.labelFr}
                              </span>
                              <span className="text-xs text-foreground-muted pt-0.5">{rule.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Search Stats */}
              <div className="pt-3 border-t border-border">
                <p className="text-xs font-medium text-foreground-secondary uppercase tracking-wider mb-2">
                  {t('recommendations.analysisInput.searchStats')}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <div>
                    <span className="text-foreground-secondary">{t('recommendations.analysisInput.totalProfessionals')}: </span>
                    <span className="font-medium text-foreground">{totalProfessionals}</span>
                  </div>
                  <div>
                    <span className="text-foreground-secondary">{t('recommendations.analysisInput.eligible')}: </span>
                    <span className="font-medium text-sage-600">{eligibleCount}</span>
                  </div>
                  {filteredByClientele > 0 && (
                    <div>
                      <span className="text-foreground-muted text-xs">
                        ({filteredByClientele} filtrés par clientèle)
                      </span>
                    </div>
                  )}
                  {exclusionCount > 0 && (
                    <div>
                      <span className="text-foreground-secondary">{t('recommendations.analysisInput.excluded')}: </span>
                      <span className="font-medium text-wine-600">{exclusionCount}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
