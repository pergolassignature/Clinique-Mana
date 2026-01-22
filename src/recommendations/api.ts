// src/recommendations/api.ts
// API functions for the Professional Recommendation System.
// Orchestrates data collection, matching, and database storage.

import { supabase } from '@/lib/supabaseClient'
import type {
  DemandeRecommendation,
  GenerateRecommendationsResult,
  RecommendationProfessionalDetail,
  ExclusionRecord,
  NearEligible,
  AIAdvisoryOutput,
  RecommendationConfig,
  DemandeData,
} from './types'
import { collectRecommendationData } from './data-collector'
import {
  matchProfessionals,
  type SimpleMatcherInput,
  type MatchedProfessional,
  type SchedulePreference,
  type DemandType,
} from './simple-matcher'

// =============================================================================
// TYPES
// =============================================================================

export interface GenerateRecommendationsOptions {
  configKey?: string
  forceRegenerate?: boolean
}

// =============================================================================
// DATABASE MAPPERS
// =============================================================================

interface DbRecommendationRow {
  id: string
  demande_id: string
  config_id: string | null
  input_snapshot: Record<string, unknown>
  recommendations: RecommendationProfessionalDetail[]
  ai_summary_fr: string | null
  ai_extracted_preferences: AIAdvisoryOutput['extractedPreferences'] | null
  exclusions: ExclusionRecord[] | null
  near_eligible: NearEligible[] | null
  generated_at: string
  generated_by: string | null
  model_version: string | null
  processing_time_ms: number | null
  is_current: boolean
  demandes: {
    demande_id: string
  } | null
}

function mapDbRowToDemandeRecommendation(row: DbRecommendationRow): DemandeRecommendation {
  return {
    id: row.id,
    demandeId: row.demandes?.demande_id || row.demande_id,
    configId: row.config_id,
    inputSnapshot: row.input_snapshot,
    recommendations: row.recommendations || [],
    aiSummaryFr: row.ai_summary_fr,
    aiExtractedPreferences: row.ai_extracted_preferences,
    exclusions: row.exclusions || [],
    nearEligible: row.near_eligible || [],
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    modelVersion: row.model_version,
    processingTimeMs: row.processing_time_ms,
    isCurrent: row.is_current,
  }
}

// =============================================================================
// FETCH RECOMMENDATIONS
// =============================================================================

/**
 * Fetch the current (active) recommendations for a demande.
 * Returns null if no recommendations exist.
 *
 * @param demandeId - The demande display ID (e.g., 'DEM-2026-0042')
 * @returns Current recommendations or null
 */
export async function fetchRecommendations(
  demandeId: string
): Promise<DemandeRecommendation | null> {
  // First, get the demande UUID from the display ID
  const { data: demande, error: demandeError } = await supabase
    .from('demandes')
    .select('id, demande_id')
    .eq('demande_id', demandeId)
    .single()

  if (demandeError) {
    if (demandeError.code === 'PGRST116') {
      // No demande found
      return null
    }
    throw new Error(`Failed to fetch demande: ${demandeError.message}`)
  }

  // Fetch the current recommendation
  const { data, error } = await supabase
    .from('demande_recommendations')
    .select(`
      id,
      demande_id,
      config_id,
      input_snapshot,
      recommendations,
      ai_summary_fr,
      ai_extracted_preferences,
      exclusions,
      near_eligible,
      generated_at,
      generated_by,
      model_version,
      processing_time_ms,
      is_current,
      demandes:demande_id (
        demande_id
      )
    `)
    .eq('demande_id', demande.id)
    .eq('is_current', true)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch recommendations: ${error.message}`)
  }

  if (!data) {
    return null
  }

  // Cast through unknown to handle Supabase's dynamic return types
  return mapDbRowToDemandeRecommendation(data as unknown as DbRecommendationRow)
}

// =============================================================================
// LOG RECOMMENDATION VIEW
// =============================================================================

/**
 * Log that a recommendation was viewed (for audit trail).
 *
 * @param recommendationId - UUID of the recommendation
 */
export async function logRecommendationView(
  recommendationId: string
): Promise<void> {
  // Get current user's profile ID (not auth user ID - profiles.id != auth.users.id)
  const { data: { user } } = await supabase.auth.getUser()
  let profileId: string | null = null
  if (user?.id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()
    profileId = profile?.id || null
  }

  const { error } = await supabase
    .from('recommendation_audit_log')
    .insert({
      recommendation_id: recommendationId,
      actor_id: profileId,
      action: 'viewed',
      context: {
        timestamp: new Date().toISOString(),
      },
    })

  if (error) {
    // Log but don't throw - viewing should not fail due to audit log issues
    console.error('Failed to log recommendation view:', error.message)
  }
}

// =============================================================================
// GENERATE RECOMMENDATIONS
// =============================================================================

/**
 * Fetch schedule preferences and primary client info from demande.
 * This queries the demande directly for schedule_preferences fields and primary participant.
 */
async function fetchDemandeMatcherInput(
  demandeId: string
): Promise<{
  schedulePreferences: SchedulePreference[]
  schedulePreferenceDetail: string | null
  primaryClientId: string | null
  primaryClientBirthday: string | null
}> {
  const { data, error } = await supabase
    .from('demandes')
    .select(`
      schedule_preferences,
      schedule_preference_detail,
      demande_participants (
        id,
        role,
        client_id,
        clients:client_id (
          id,
          birthday
        )
      )
    `)
    .eq('demande_id', demandeId)
    .single()

  if (error) {
    console.error('Failed to fetch demande matcher input:', error.message)
    return {
      schedulePreferences: [],
      schedulePreferenceDetail: null,
      primaryClientId: null,
      primaryClientBirthday: null,
    }
  }

  // Find principal participant (role = 'principal')
  interface ParticipantRow {
    id: string
    role: 'principal' | 'participant'
    client_id: string
    clients: {
      id: string
      birthday: string | null
    } | null
  }
  const participants = (data.demande_participants || []) as unknown as ParticipantRow[]
  const primaryParticipant = participants.find((p) => p.role === 'principal') || participants[0]

  // Pass all schedule preferences (empty array = no filtering)
  const schedulePreferences = (data.schedule_preferences as SchedulePreference[]) || []

  return {
    schedulePreferences,
    schedulePreferenceDetail: data.schedule_preference_detail || null,
    primaryClientId: primaryParticipant?.clients?.id || null,
    primaryClientBirthday: primaryParticipant?.clients?.birthday || null,
  }
}

/**
 * Map MatchedProfessional from simple-matcher to RecommendationProfessionalDetail.
 */
function mapMatchedToDetail(
  matched: MatchedProfessional,
  index: number
): RecommendationProfessionalDetail {
  return {
    id: crypto.randomUUID(),
    professionalId: matched.professionalId,
    rank: index + 1,
    totalScore: matched.motifScore, // Use motif score as total
    motifMatchScore: matched.motifScore,
    specialtyMatchScore: 0, // No longer calculated
    availabilityScore: matched.availableSlotsCount > 0 ? 1 : 0,
    professionFitScore: 0, // No longer calculated
    experienceScore: 0, // No longer calculated
    aiRankingAdjustment: null,
    aiReasoningBullets: [],
    matchedMotifs: matched.matchedMotifs,
    unmatchedMotifs: matched.unmatchedMotifs,
    matchedSpecialties: [],
    availableSlotsCount: matched.availableSlotsCount,
    nextAvailableSlot: matched.nextAvailableSlot,
    displayName: matched.displayName,
    professionTitles: matched.professionTitles,
  }
}

/**
 * Generate professional recommendations for a demande.
 * This is the main orchestration function that:
 * 1. Collects candidate data via collectRecommendationData
 * 2. Fetches schedule preference and primary client info
 * 3. Calls matchProfessionals with SimpleMatcherInput
 * 4. Maps results to RecommendationProfessionalDetail
 * 5. Stores results in database
 * 6. Returns results
 *
 * @param demandeId - The demande display ID (e.g., 'DEM-2026-0042')
 * @param options - Optional configuration (configKey, forceRegenerate)
 * @returns Generation result with recommendations, exclusions, and metadata
 */
export async function generateRecommendations(
  demandeId: string,
  options: GenerateRecommendationsOptions = {}
): Promise<GenerateRecommendationsResult> {
  const startTime = Date.now()
  const { configKey = 'default', forceRegenerate = false } = options

  try {
    // Check if current recommendations exist (unless force regenerating)
    if (!forceRegenerate) {
      const existing = await fetchRecommendations(demandeId)
      if (existing) {
        return {
          success: true,
          recommendationId: existing.id,
          recommendations: existing.recommendations,
          aiSummaryFr: existing.aiSummaryFr || undefined,
          exclusions: existing.exclusions,
          nearEligible: existing.nearEligible,
          processingTimeMs: 0,
        }
      }
    }

    // Step 1: Collect all candidate data
    const dataBundle = await collectRecommendationData(demandeId, configKey)
    const { demande, candidates, config } = dataBundle

    // Step 2: Fetch schedule preference and primary client info
    const matcherInput = await fetchDemandeMatcherInput(demandeId)

    // Step 3: Build SimpleMatcherInput
    const simpleInput: SimpleMatcherInput = {
      demande: {
        id: demande.id,
        demandType: demande.demandType as DemandType,
        selectedMotifs: demande.motifKeys,
        schedulePreferences: matcherInput.schedulePreferences,
        schedulePreferenceDetail: matcherInput.schedulePreferenceDetail,
      },
      primaryClient: {
        id: matcherInput.primaryClientId || '',
        birthday: matcherInput.primaryClientBirthday,
      },
    }

    // Step 4: Call matchProfessionals
    const matchResult = await matchProfessionals(simpleInput, candidates)

    // Step 5: Build exclusions from filter counts
    const exclusions: ExclusionRecord[] = []
    // Note: simple-matcher tracks filter counts but not individual exclusion reasons
    // We track total filtered for the input snapshot
    const nearEligible: NearEligible[] = []

    // Step 6: Map matched professionals to RecommendationProfessionalDetail
    const recommendations: RecommendationProfessionalDetail[] = matchResult.professionals.map(
      (matched, index) => mapMatchedToDetail(matched, index)
    )

    // Step 7: Store results
    const processingTimeMs = Date.now() - startTime
    const stored = await storeRecommendations({
      demandeId,
      demande,
      config,
      recommendations,
      exclusions,
      nearEligible,
      matchResult: {
        totalEvaluated: matchResult.totalEvaluated,
        filteredByClientele: matchResult.filteredByClientele,
        filteredByAvailability: matchResult.filteredByAvailability,
      },
      processingTimeMs,
    })

    return {
      success: true,
      recommendationId: stored.id,
      recommendations,
      exclusions,
      nearEligible,
      processingTimeMs,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to generate recommendations:', errorMessage)

    return {
      success: false,
      recommendations: [],
      exclusions: [],
      nearEligible: [],
      processingTimeMs: Date.now() - startTime,
      error: errorMessage,
    }
  }
}

// =============================================================================
// DATABASE STORAGE
// =============================================================================

interface StoreRecommendationsInput {
  demandeId: string
  demande: DemandeData
  config: RecommendationConfig
  recommendations: RecommendationProfessionalDetail[]
  exclusions: ExclusionRecord[]
  nearEligible: NearEligible[]
  matchResult: {
    totalEvaluated: number
    filteredByClientele: number
    filteredByAvailability: number
  }
  processingTimeMs: number
}

/**
 * Store recommendations in the database.
 * Handles superseding previous recommendations and creating detail records.
 */
async function storeRecommendations(
  input: StoreRecommendationsInput
): Promise<{ id: string }> {
  const {
    demandeId,
    demande,
    config,
    recommendations,
    exclusions,
    nearEligible,
    matchResult,
    processingTimeMs,
  } = input

  // Get the demande UUID from the display ID
  const { data: demandeRow, error: demandeError } = await supabase
    .from('demandes')
    .select('id')
    .eq('demande_id', demandeId)
    .single()

  if (demandeError) {
    throw new Error(`Failed to fetch demande UUID: ${demandeError.message}`)
  }

  const demandeUuid = demandeRow.id

  // Get current user's profile ID (not auth user ID - profiles.id != auth.users.id)
  const { data: { user } } = await supabase.auth.getUser()
  let profileId: string | null = null
  if (user?.id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()
    profileId = profile?.id || null
  }

  // Mark previous recommendations as superseded
  const { error: supersedError } = await supabase
    .from('demande_recommendations')
    .update({
      is_current: false,
      superseded_at: new Date().toISOString(),
    })
    .eq('demande_id', demandeUuid)
    .eq('is_current', true)

  if (supersedError) {
    console.error('Failed to supersede previous recommendations:', supersedError.message)
    // Continue anyway - this is not critical
  }

  // Build input snapshot (sanitized, no client PII)
  const inputSnapshot = {
    demandType: demande.demandType,
    urgencyLevel: demande.urgencyLevel,
    motifKeys: demande.motifKeys,
    clienteleCategories: demande.clienteleCategories,
    hasLegalContext: demande.hasLegalContext,
    configKey: config.key,
    // Total professionals analyzed (before any filters)
    totalProfessionalsAnalyzed: matchResult.totalEvaluated,
    candidateCount: recommendations.length,
    matchResult: {
      totalEvaluated: matchResult.totalEvaluated,
      filteredByClientele: matchResult.filteredByClientele,
      filteredByAvailability: matchResult.filteredByAvailability,
    },
    timestamp: new Date().toISOString(),
  }

  // Insert new recommendation
  const { data: newRec, error: insertError } = await supabase
    .from('demande_recommendations')
    .insert({
      demande_id: demandeUuid,
      config_id: config.id !== 'default' ? config.id : null,
      input_snapshot: inputSnapshot,
      recommendations: recommendations,
      ai_summary_fr: null,
      ai_extracted_preferences: null,
      exclusions: exclusions,
      near_eligible: nearEligible,
      generated_by: profileId,
      model_version: 'simple-matcher-v1',
      processing_time_ms: processingTimeMs,
      is_current: true,
    })
    .select('id')
    .single()

  if (insertError) {
    throw new Error(`Failed to insert recommendation: ${insertError.message}`)
  }

  // Insert professional detail records for top recommendations
  if (recommendations.length > 0) {
    const detailRecords = recommendations.map((rec) => ({
      recommendation_id: newRec.id,
      professional_id: rec.professionalId,
      rank: rec.rank,
      total_score: rec.totalScore,
      motif_match_score: rec.motifMatchScore,
      specialty_match_score: rec.specialtyMatchScore,
      availability_score: rec.availabilityScore,
      profession_fit_score: rec.professionFitScore,
      experience_score: rec.experienceScore,
      ai_ranking_adjustment: rec.aiRankingAdjustment,
      ai_reasoning_bullets: rec.aiReasoningBullets,
      matched_motifs: rec.matchedMotifs,
      matched_specialties: rec.matchedSpecialties,
      available_slots_count: rec.availableSlotsCount,
      next_available_slot: rec.nextAvailableSlot,
    }))

    const { error: detailError } = await supabase
      .from('recommendation_professional_details')
      .insert(detailRecords)

    if (detailError) {
      console.error('Failed to insert detail records:', detailError.message)
      // Continue anyway - the main recommendation is stored
    }
  }

  // Insert audit log entry
  const { error: auditError } = await supabase
    .from('recommendation_audit_log')
    .insert({
      recommendation_id: newRec.id,
      actor_id: profileId,
      action: 'generated',
      context: {
        configKey: config.key,
        candidateCount: recommendations.length,
        exclusionCount: exclusions.length,
        matchResult,
        processingTimeMs,
      },
    })

  if (auditError) {
    console.error('Failed to insert audit log:', auditError.message)
    // Continue anyway - audit logging is not critical
  }

  return { id: newRec.id }
}
