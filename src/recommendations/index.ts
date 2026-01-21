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
  calculatePopulationCategory,
  fetchDemandeData,
  fetchActiveProfessionals,
  fetchProfessionalAvailability,
  batchFetchAvailability,
  fetchRecommendationConfig,
  getDefaultConfig,
} from './data-collector'

export type { PopulationCategory } from './data-collector'

// Sanitizer
export {
  sanitizeForAI,
  validateSanitizedInput,
  sanitizeText,
  combineClientText,
  sanitizeCandidate,
  calculatePreliminaryScore,
} from './sanitizer'
