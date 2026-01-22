// src/recommendations/index.ts
// Professional Recommendation System - Module exports

// Types
export type {
  ExclusionReasonCode,
  RecommendationConfig,
  ExclusionRecord,
  DeterministicScores,
  NearEligible,
  AIAdvisoryInput,
  AIAdvisoryOutput,
  RecommendationProfessionalDetail,
  DemandeRecommendation,
  GenerateRecommendationsInput,
  GenerateRecommendationsResult,
  CandidateData,
  DemandeData,
  RecommendationDataBundle,
} from './types'

// Zod schemas for validation
export {
  ExclusionReasonCode as ExclusionReasonCodeSchema,
  RecommendationConfigSchema,
  ExclusionRecordSchema,
  DeterministicScoresSchema,
  NearEligibleSchema,
  AIAdvisoryInputSchema,
  AIAdvisoryOutputSchema,
  RecommendationProfessionalDetailSchema,
  DemandeRecommendationSchema,
  GenerateRecommendationsInputSchema,
  GenerateRecommendationsResultSchema,
} from './types'

// Data collector
export {
  collectRecommendationData,
  calculateAge,
  calculateClienteleCategory,
  fetchDemandeData,
  fetchActiveProfessionals,
  fetchProfessionalAvailability,
  batchFetchAvailability,
  fetchRecommendationConfig,
  getDefaultConfig,
} from './data-collector'

export type { ClienteleCategory } from './data-collector'

// Deterministic scorer
export {
  preFilterProfessionals,
  calculateDeterministicScores,
  sortByScore,
  countMatchedMotifs,
  hasAnySpecialty,
  getSpecialtyProficiency,
} from './deterministic-scorer'

export type { PreFilterResult } from './deterministic-scorer'

// API functions
export {
  generateRecommendations,
  fetchRecommendations,
  logRecommendationView,
} from './api'

export type { GenerateRecommendationsOptions } from './api'

// React Query hooks
export {
  useDemandeRecommendations,
  useRecommendations,
  useGenerateRecommendations,
  useLogRecommendationView,
  useLogRecommendationViewMutation,
  recommendationKeys,
} from './hooks'

export type { UseDemandeRecommendationsResult } from './hooks'

// UI Components
export {
  RecommendationsPanel,
  RecommendationCard,
  ScoreBreakdown,
  ScoreBadge,
  ExclusionsSummary,
  NearEligibleList,
  LoadingSkeleton,
  RecommendationCardSkeleton,
} from './components'

export type {
  RecommendationsPanelProps,
  RecommendationCardProps,
} from './components'
