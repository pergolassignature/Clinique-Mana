// src/recommendations/types.ts
// TypeScript types for the Professional Recommendation System

import { z } from 'zod'
import type { HolisticSignal, HolisticCategory } from './holistic-classifier'

export type { HolisticSignal, HolisticCategory }

// =============================================================================
// EXCLUSION REASON CODES
// =============================================================================

/**
 * Reason codes for excluding a professional from recommendations.
 * Used in both exclusion records and near-eligible tracking.
 */
export const ExclusionReasonCode = z.enum([
  'no_availability',         // No slots within configured time window
  'no_motif_overlap',        // Required motifs not matched
  'no_clientele_match',      // Clientele specialty not matched
  'no_demand_type_specialty', // Demand type (couple, family) specialty missing
  'inactive_status',         // Professional not active
])
export type ExclusionReasonCode = z.infer<typeof ExclusionReasonCode>

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Algorithm configuration for generating recommendations.
 * Stored in recommendation_configs table.
 * Allows fine-tuning of scoring weights and hard constraints.
 */
export interface RecommendationConfig {
  id: string
  key: string
  nameFr: string
  descriptionFr: string | null

  // Prompt templates
  systemPrompt: string
  userPromptTemplate: string

  // Scoring weights (should sum to 1.0 for normalized scoring)
  weightMotifMatch: number
  weightSpecialtyMatch: number
  weightAvailability: number
  weightProfessionFit: number
  weightExperience: number

  // Hard constraints
  requireAvailabilityWithinDays: number
  requireMotifOverlap: boolean
  requireClienteleMatch: boolean

  // Normalization parameters
  availabilityMaxHours: number  // Max hours for availability scoring (beyond this = max score)
  experienceMaxYears: number    // Max years for experience scoring (beyond this = max score)

  isActive: boolean
}

export const RecommendationConfigSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  nameFr: z.string(),
  descriptionFr: z.string().nullable(),
  systemPrompt: z.string(),
  userPromptTemplate: z.string(),
  weightMotifMatch: z.number().min(0).max(1),
  weightSpecialtyMatch: z.number().min(0).max(1),
  weightAvailability: z.number().min(0).max(1),
  weightProfessionFit: z.number().min(0).max(1),
  weightExperience: z.number().min(0).max(1),
  requireAvailabilityWithinDays: z.number().int().positive(),
  requireMotifOverlap: z.boolean(),
  requireClienteleMatch: z.boolean(),
  availabilityMaxHours: z.number().positive(),
  experienceMaxYears: z.number().positive(),
  isActive: z.boolean(),
})

// =============================================================================
// EXCLUSION TYPES
// =============================================================================

/**
 * Record of why a professional was excluded from recommendations.
 * Stored in demande_recommendations.exclusions JSONB array.
 */
export interface ExclusionRecord {
  professionalId: string
  reasonCode: ExclusionReasonCode
  reasonFr: string  // Human-readable explanation in French
  details?: Record<string, unknown>  // Additional context (e.g., missing motifs)
}

export const ExclusionRecordSchema = z.object({
  professionalId: z.string().uuid(),
  reasonCode: ExclusionReasonCode,
  reasonFr: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
})

// =============================================================================
// SCORE TYPES
// =============================================================================

/**
 * Breakdown of deterministic (non-AI) scores for a professional.
 * These scores are calculated from objective data matching.
 */
export interface DeterministicScores {
  motifMatchScore: number       // 0-1: Percentage of request motifs matched
  specialtyMatchScore: number   // 0-1: Relevant specialties matched
  availabilityScore: number     // 0-1: Based on slots available within window
  professionFitScore: number    // 0-1: Profession type match for demand
  experienceScore: number       // 0-1: Years of experience (normalized)
  totalScore: number            // Weighted sum of above scores
}

export const DeterministicScoresSchema = z.object({
  motifMatchScore: z.number().min(0).max(1),
  specialtyMatchScore: z.number().min(0).max(1),
  availabilityScore: z.number().min(0).max(1),
  professionFitScore: z.number().min(0).max(1),
  experienceScore: z.number().min(0).max(1),
  totalScore: z.number().min(0),
})

/**
 * Professional who nearly qualified but failed one constraint.
 * Useful for showing "could be available if..." scenarios.
 */
export interface NearEligible {
  professionalId: string
  displayName: string  // Professional's display name
  professionTitles: string[]  // Profession titles (e.g., ["Psychologue"])
  missingConstraint: ExclusionReasonCode
  reasonFr: string  // Human-readable explanation in French
  scores: DeterministicScores
  nextAvailableDate?: string  // ISO date if excluded for availability
  details?: Record<string, unknown>  // Additional context (e.g., missing motifs)
}

export const NearEligibleSchema = z.object({
  professionalId: z.string().uuid(),
  displayName: z.string(),
  professionTitles: z.array(z.string()),
  missingConstraint: ExclusionReasonCode,
  reasonFr: z.string(),
  scores: DeterministicScoresSchema,
  nextAvailableDate: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})

// =============================================================================
// AI ADVISORY TYPES
// =============================================================================

/**
 * Input prepared for the AI advisory layer.
 * Contains structured data extracted from the demande and candidate pool.
 */
export interface AIAdvisoryInput {
  demandType: string
  urgencyLevel: string
  motifKeys: string[]
  clientText: string           // Combined motif description + notes
  hasLegalContext: boolean     // Flag for legal/mediation cases
  clienteleCategories: string[]
  // Holistic signal for naturopath preference
  holisticSignal: {
    score: number              // 0-1, higher = more holistic intent
    category: string           // 'body' | 'energy' | 'lifestyle' | 'global' | 'none'
    matchedKeywords: string[]  // Keywords found in client text
    recommendNaturopath: boolean  // true if score > 0.5 AND no clinical override
    hasClinicalOverride: boolean  // true if crisis keywords detected
  }
  candidates: Array<{
    id: string
    professionType: string
    deterministicScore: number
    matchedMotifCount: number
    availableSlotCount: number
    yearsExperience: number
  }>
}

export const AIAdvisoryInputSchema = z.object({
  demandType: z.string(),
  urgencyLevel: z.string(),
  motifKeys: z.array(z.string()),
  clientText: z.string(),
  hasLegalContext: z.boolean(),
  clienteleCategories: z.array(z.string()),
  holisticSignal: z.object({
    score: z.number().min(0).max(1),
    category: z.string(),
    matchedKeywords: z.array(z.string()),
    recommendNaturopath: z.boolean(),
    hasClinicalOverride: z.boolean(),
  }),
  candidates: z.array(z.object({
    id: z.string().uuid(),
    professionType: z.string(),
    deterministicScore: z.number(),
    matchedMotifCount: z.number().int(),
    availableSlotCount: z.number().int(),
    yearsExperience: z.number(),
  })),
})

/**
 * Output from the AI advisory layer.
 * Provides ranking adjustments and qualitative insights.
 */
export interface AIAdvisoryOutput {
  extractedPreferences: {
    preferredTiming?: string      // e.g., "morning", "evenings only"
    preferredModality?: string    // e.g., "in-person", "video"
    otherConstraints?: string[]   // Other extracted needs
  }
  rankings: Array<{
    professionalId: string
    rankingAdjustment: number     // -5 to +5 adjustment to final ranking
    reasoningBullets: string[]    // French explanation bullets
  }>
  summaryFr: string               // French summary for staff
}

export const AIAdvisoryOutputSchema = z.object({
  extractedPreferences: z.object({
    preferredTiming: z.string().optional(),
    preferredModality: z.string().optional(),
    otherConstraints: z.array(z.string()).optional(),
  }),
  rankings: z.array(z.object({
    professionalId: z.string().uuid(),
    rankingAdjustment: z.number().min(-5).max(5),
    reasoningBullets: z.array(z.string()),
  })),
  summaryFr: z.string(),
})

// =============================================================================
// RECOMMENDATION DETAIL TYPES
// =============================================================================

/**
 * Full detail for a single recommended professional.
 * Stored in demande_recommendations.recommendations JSONB array.
 */
export interface RecommendationProfessionalDetail {
  id: string                      // Unique ID for this recommendation entry
  professionalId: string
  rank: number                    // Final rank (1 = best match)

  // Score breakdown
  totalScore: number
  motifMatchScore: number
  specialtyMatchScore: number
  availabilityScore: number
  professionFitScore: number
  experienceScore: number

  // AI adjustments
  aiRankingAdjustment: number | null
  aiReasoningBullets: string[]

  // Match details
  matchedMotifs: string[]         // Motif keys that matched
  unmatchedMotifs: string[]       // Motif keys from demande that professional doesn't cover
  matchedSpecialties: string[]    // Specialty codes that matched
  availableSlotsCount: number
  nextAvailableSlot: string | null  // ISO datetime

  // UI display fields (populated from joined data)
  displayName?: string
  professionTitles?: string[]
}

export const RecommendationProfessionalDetailSchema = z.object({
  id: z.string().uuid(),
  professionalId: z.string().uuid(),
  rank: z.number().int().positive(),
  totalScore: z.number().min(0),
  motifMatchScore: z.number().min(0).max(1),
  specialtyMatchScore: z.number().min(0).max(1),
  availabilityScore: z.number().min(0).max(1),
  professionFitScore: z.number().min(0).max(1),
  experienceScore: z.number().min(0).max(1),
  aiRankingAdjustment: z.number().min(-5).max(5).nullable(),
  aiReasoningBullets: z.array(z.string()),
  matchedMotifs: z.array(z.string()),
  unmatchedMotifs: z.array(z.string()),
  matchedSpecialties: z.array(z.string()),
  availableSlotsCount: z.number().int().min(0),
  nextAvailableSlot: z.string().nullable(),
  displayName: z.string().optional(),
  professionTitles: z.array(z.string()).optional(),
})

// =============================================================================
// DEMANDE RECOMMENDATION TYPES
// =============================================================================

/**
 * Complete recommendation result for a demande.
 * Maps to demande_recommendations table.
 */
export interface DemandeRecommendation {
  id: string
  demandeId: string
  configId: string | null

  // Snapshot of input data used for generation (for reproducibility)
  inputSnapshot: Record<string, unknown>

  // Results
  recommendations: RecommendationProfessionalDetail[]
  aiSummaryFr: string | null
  aiExtractedPreferences: AIAdvisoryOutput['extractedPreferences'] | null
  exclusions: ExclusionRecord[]
  nearEligible: NearEligible[]

  // Metadata
  generatedAt: string             // ISO datetime
  generatedBy: string | null      // Profile ID of user who triggered
  modelVersion: string | null     // AI model version used
  processingTimeMs: number | null

  isCurrent: boolean              // True if this is the active recommendation
}

export const DemandeRecommendationSchema = z.object({
  id: z.string().uuid(),
  demandeId: z.string(),
  configId: z.string().uuid().nullable(),
  inputSnapshot: z.record(z.string(), z.unknown()),
  recommendations: z.array(RecommendationProfessionalDetailSchema),
  aiSummaryFr: z.string().nullable(),
  aiExtractedPreferences: z.object({
    preferredTiming: z.string().optional(),
    preferredModality: z.string().optional(),
    otherConstraints: z.array(z.string()).optional(),
  }).nullable(),
  exclusions: z.array(ExclusionRecordSchema),
  nearEligible: z.array(NearEligibleSchema),
  generatedAt: z.string().datetime(),
  generatedBy: z.string().uuid().nullable(),
  modelVersion: z.string().nullable(),
  processingTimeMs: z.number().int().nullable(),
  isCurrent: z.boolean(),
})

// =============================================================================
// API INPUT/OUTPUT TYPES
// =============================================================================

/**
 * Input for generating recommendations for a demande.
 */
export interface GenerateRecommendationsInput {
  demandeId: string
  configKey?: string              // Which config to use (defaults to 'default')
  forceRegenerate?: boolean       // Regenerate even if current exists
}

export const GenerateRecommendationsInputSchema = z.object({
  demandeId: z.string(),
  configKey: z.string().optional(),
  forceRegenerate: z.boolean().optional(),
})

/**
 * Result from generating recommendations.
 */
export interface GenerateRecommendationsResult {
  success: boolean
  recommendationId?: string
  recommendations: RecommendationProfessionalDetail[]
  aiSummaryFr?: string
  exclusions: ExclusionRecord[]
  nearEligible: NearEligible[]
  processingTimeMs?: number
  error?: string
}

export const GenerateRecommendationsResultSchema = z.object({
  success: z.boolean(),
  recommendationId: z.string().uuid().optional(),
  recommendations: z.array(RecommendationProfessionalDetailSchema),
  aiSummaryFr: z.string().optional(),
  exclusions: z.array(ExclusionRecordSchema),
  nearEligible: z.array(NearEligibleSchema),
  processingTimeMs: z.number().int().optional(),
  error: z.string().optional(),
})

// =============================================================================
// DATA COLLECTOR TYPES (Internal)
// =============================================================================

/**
 * Collected data for a single professional candidate.
 * Used internally by the data-collector module.
 */
export interface CandidateData {
  professional: {
    id: string
    profileId: string
    displayName: string
    status: string
    yearsExperience: number | null
  }
  professions: Array<{
    titleKey: string
    labelFr: string
    categoryKey: string
    isPrimary: boolean
  }>
  motifs: string[]           // Array of motif keys
  specialties: Array<{
    code: string
    category: string
    proficiencyLevel: string | null
  }>
  availability: {
    slotsInWindow: number
    nextSlotDatetime: string | null
    hoursAvailableInWindow: number
  }
}

/**
 * Collected data for the demande being matched.
 */
export interface DemandeData {
  id: string
  demandType: string | null
  urgencyLevel: string | null
  motifKeys: string[]
  motifDescription: string
  otherMotifText: string
  notes: string
  clienteleCategories: string[]  // Extracted from participant data
  hasLegalContext: boolean
}

/**
 * Complete data bundle for recommendation generation.
 */
export interface RecommendationDataBundle {
  demande: DemandeData
  candidates: CandidateData[]
  config: RecommendationConfig
  holisticSignal: HolisticSignal
  collectedAt: string
}
