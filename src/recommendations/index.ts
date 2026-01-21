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

// AI Advisory
export {
  getAIAdvisory,
  isAIAdvisoryAvailable,
  getAIModelIdentifier,
  applyAIAdjustments,
  getReasoningForProfessional,
} from './ai-advisory'

export type { AIAdvisoryOptions, AIAdvisoryResult } from './ai-advisory'

// Prompt building utilities
export {
  buildUserPrompt,
  validatePromptTemplate,
  PLACEHOLDERS,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT_TEMPLATE,
} from './prompts'
