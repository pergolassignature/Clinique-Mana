// src/recommendations/api.ts
// API functions for the Professional Recommendation System.
// Orchestrates data collection, scoring, AI advisory, and database storage.

import { supabase } from '@/lib/supabaseClient'
import type {
  DemandeRecommendation,
  GenerateRecommendationsResult,
  RecommendationProfessionalDetail,
  ExclusionRecord,
  NearEligible,
  AIAdvisoryOutput,
  CandidateData,
  DemandeData,
  RecommendationConfig,
  DeterministicScores,
  HolisticSignal,
} from './types'
import {
  collectRecommendationData,
} from './data-collector'
import {
  preFilterProfessionals,
  calculateDeterministicScores,
} from './deterministic-scorer'
import {
  sanitizeForAI,
} from './sanitizer'
import {
  getAIAdvisory,
  applyAIAdjustments,
  getReasoningForProfessional,
  getAIModelIdentifier,
} from './ai-advisory'

// =============================================================================
// TYPES
// =============================================================================

export interface GenerateRecommendationsOptions {
  configKey?: string
  forceRegenerate?: boolean
}

/**
 * Internal type for scored candidates during processing.
 */
interface ScoredCandidate {
  candidate: CandidateData
  professionalId: string
  scores: DeterministicScores & { matchedMotifs: string[]; matchedSpecialties: string[] }
  totalScore: number
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
 * Generate professional recommendations for a demande.
 * This is the main orchestration function that:
 * 1. Collects all data via collectRecommendationData
 * 2. Pre-filters professionals via preFilterProfessionals
 * 3. Calculates deterministic scores via calculateDeterministicScores
 * 4. Gets AI advisory via getAIAdvisory (if candidates exist)
 * 5. Combines scores and AI adjustments
 * 6. Stores results in database
 * 7. Returns results
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

    // Step 1: Collect all data
    const dataBundle = await collectRecommendationData(demandeId, configKey)
    const { demande, candidates, config, holisticSignal } = dataBundle

    // Step 2: Pre-filter by hard constraints
    const filterResult = preFilterProfessionals(candidates, demande, config)
    const { eligible, exclusions, nearEligible } = filterResult

    // If no eligible candidates, return early
    if (eligible.length === 0) {
      const result = await storeRecommendations({
        demandeId,
        demande,
        config,
        holisticSignal,
        recommendations: [],
        exclusions,
        nearEligible,
        aiOutput: null,
        processingTimeMs: Date.now() - startTime,
      })

      return {
        success: true,
        recommendationId: result.id,
        recommendations: [],
        exclusions,
        nearEligible,
        processingTimeMs: Date.now() - startTime,
      }
    }

    // Step 3: Calculate deterministic scores for eligible candidates
    const scoredCandidates: ScoredCandidate[] = eligible.map((candidate) => {
      const scores = calculateDeterministicScores(candidate, demande, config, holisticSignal)
      return {
        candidate,
        professionalId: candidate.professional.id,
        scores,
        totalScore: scores.totalScore,
      }
    })

    // Step 4: Get AI advisory (if candidates exist)
    const sanitizedInput = sanitizeForAI(dataBundle)
    // Only include eligible candidates in AI input
    sanitizedInput.candidates = sanitizedInput.candidates.filter((c) =>
      eligible.some((e) => e.professional.id === c.id)
    )

    const aiResult = await getAIAdvisory(sanitizedInput, config)
    const aiOutput = aiResult.output

    // Step 5: Apply AI adjustments and sort
    const adjustedCandidates = applyAIAdjustments(
      scoredCandidates.map((sc) => ({
        ...sc,
        professionalId: sc.professionalId,
        totalScore: sc.totalScore,
      })),
      aiOutput
    )

    // Step 6: Build final recommendations (top 3)
    const topCandidates = adjustedCandidates.slice(0, 3)
    const recommendations: RecommendationProfessionalDetail[] = topCandidates.map(
      (adjusted, index) => {
        const original = scoredCandidates.find(
          (sc) => sc.professionalId === adjusted.professionalId
        )!
        const aiRanking = aiOutput.rankings.find(
          (r) => r.professionalId === adjusted.professionalId
        )

        return {
          id: crypto.randomUUID(),
          professionalId: adjusted.professionalId,
          rank: index + 1,
          totalScore: adjusted.adjustedScore,
          motifMatchScore: original.scores.motifMatchScore,
          specialtyMatchScore: original.scores.specialtyMatchScore,
          availabilityScore: original.scores.availabilityScore,
          professionFitScore: original.scores.professionFitScore,
          experienceScore: original.scores.experienceScore,
          aiRankingAdjustment: aiRanking?.rankingAdjustment ?? null,
          aiReasoningBullets: getReasoningForProfessional(
            adjusted.professionalId,
            aiOutput
          ),
          matchedMotifs: original.scores.matchedMotifs,
          matchedSpecialties: original.scores.matchedSpecialties,
          availableSlotsCount: original.candidate.availability.slotsInWindow,
          nextAvailableSlot: original.candidate.availability.nextSlotDatetime,
          displayName: original.candidate.professional.displayName,
          professionTitles: original.candidate.professions.map((p) => p.labelFr),
        }
      }
    )

    // Step 7: Store results
    const processingTimeMs = Date.now() - startTime
    const stored = await storeRecommendations({
      demandeId,
      demande,
      config,
      holisticSignal,
      recommendations,
      exclusions,
      nearEligible,
      aiOutput,
      processingTimeMs,
    })

    return {
      success: true,
      recommendationId: stored.id,
      recommendations,
      aiSummaryFr: aiOutput.summaryFr,
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
// PROFESSION ELIGIBILITY RULES
// =============================================================================

interface ProfessionEligibilityRule {
  professionKey: string
  labelFr: string
  isEligible: boolean
  reason: string
  priority: 'preferred' | 'eligible' | 'not_recommended'
}

/**
 * Build profession eligibility rules based on demand type, context, and holistic signal.
 * Explains which professions are appropriate and why.
 *
 * @param demande - The demand data
 * @param holisticSignal - Optional holistic signal for naturopath preference
 */
function buildProfessionEligibilityRules(
  demande: DemandeData,
  holisticSignal?: HolisticSignal
): ProfessionEligibilityRule[] {
  const rules: ProfessionEligibilityRule[] = []

  // Define all profession types with French labels
  const professionTypes = [
    { key: 'psychologue', labelFr: 'Psychologue' },
    { key: 'travailleur_social', labelFr: 'Travailleur social' },
    { key: 'psychotherapeute', labelFr: 'Psychothérapeute' },
    { key: 'conseiller_orientation', labelFr: 'Conseiller d\'orientation' },
    { key: 'sexologue', labelFr: 'Sexologue' },
    { key: 'neuropsychologue', labelFr: 'Neuropsychologue' },
    { key: 'naturopathe', labelFr: 'Naturopathe' },
  ]

  for (const profession of professionTypes) {
    const rule = evaluateProfessionEligibility(profession.key, profession.labelFr, demande, holisticSignal)
    rules.push(rule)
  }

  // Sort by priority: preferred first, then eligible, then not recommended
  const priorityOrder = { preferred: 0, eligible: 1, not_recommended: 2 }
  rules.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return rules
}

/**
 * Evaluate eligibility for a specific profession type.
 *
 * @param professionKey - The profession key (e.g., 'psychologue', 'naturopathe')
 * @param labelFr - French label for the profession
 * @param demande - The demand data
 * @param holisticSignal - Optional holistic signal for naturopath preference
 */
function evaluateProfessionEligibility(
  professionKey: string,
  labelFr: string,
  demande: DemandeData,
  holisticSignal?: HolisticSignal
): ProfessionEligibilityRule {
  // ==========================================================================
  // HOLISTIC/GLOBAL SIGNAL - Naturopath preference
  // When client text indicates body/wellness/global approach and no clinical crisis
  // ==========================================================================
  if (holisticSignal?.recommendNaturopath) {
    if (professionKey === 'naturopathe') {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: `Recommandé pour l'approche globale corps/énergie/équilibre de vie (mots-clés: ${holisticSignal.matchedKeywords.slice(0, 3).join(', ')})`,
        priority: 'preferred',
      }
    }
    // When holistic signal is present, psychologue/psychotherapeute are still eligible
    // but not preferred (naturopathe is)
    if (['psychologue', 'psychotherapeute'].includes(professionKey)) {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: 'Peut intervenir si un besoin clinique est identifié, mais approche globale suggère naturopathe',
        priority: 'eligible',
      }
    }
  }

  // Clinical override - when crisis keywords present, psychologue/psychotherapeute preferred
  if (holisticSignal?.hasClinicalOverride) {
    if (['psychologue', 'psychotherapeute'].includes(professionKey)) {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: `Recommandé pour la détresse clinique identifiée (mots-clés: ${holisticSignal.clinicalKeywordsFound.slice(0, 2).join(', ')})`,
        priority: 'preferred',
      }
    }
    // Naturopath not recommended when clinical crisis detected
    if (professionKey === 'naturopathe') {
      return {
        professionKey,
        labelFr,
        isEligible: false,
        reason: 'Non recommandé en présence d\'indicateurs de détresse clinique aiguë',
        priority: 'not_recommended',
      }
    }
  }

  // ==========================================================================
  // LEGAL CONTEXT - Social worker preference
  // ==========================================================================
  // Legal context strongly favors social workers
  if (demande.hasLegalContext) {
    if (professionKey === 'travailleur_social') {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: 'Recommandé pour les dossiers avec contexte légal (médiation, garde, etc.)',
        priority: 'preferred',
      }
    }
    if (professionKey === 'psychologue') {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: 'Peut intervenir dans un contexte légal, mais le travailleur social est préféré',
        priority: 'eligible',
      }
    }
  }

  // Couple demands
  if (demande.demandType === 'couple') {
    if (['psychologue', 'travailleur_social', 'psychotherapeute', 'sexologue'].includes(professionKey)) {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: 'Qualifié pour la thérapie de couple',
        priority: professionKey === 'sexologue' ? 'preferred' : 'eligible',
      }
    }
    return {
      professionKey,
      labelFr,
      isEligible: false,
      reason: 'Non spécialisé pour les consultations de couple',
      priority: 'not_recommended',
    }
  }

  // Family demands
  if (demande.demandType === 'family') {
    if (['psychologue', 'travailleur_social', 'psychotherapeute'].includes(professionKey)) {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: 'Qualifié pour la thérapie familiale',
        priority: professionKey === 'travailleur_social' ? 'preferred' : 'eligible',
      }
    }
    return {
      professionKey,
      labelFr,
      isEligible: false,
      reason: 'Non spécialisé pour les consultations familiales',
      priority: 'not_recommended',
    }
  }

  // Individual demands - most professions are eligible
  if (demande.demandType === 'individual' || !demande.demandType) {
    // Check for specific motifs that might prefer certain professions
    const motifKeys = demande.motifKeys || []

    // Neuropsychological concerns
    if (motifKeys.some(m => ['troubles_apprentissage', 'trouble_attention', 'evaluation_neuropsychologique'].includes(m))) {
      if (professionKey === 'neuropsychologue') {
        return {
          professionKey,
          labelFr,
          isEligible: true,
          reason: 'Spécialiste pour les évaluations neuropsychologiques et troubles cognitifs',
          priority: 'preferred',
        }
      }
    }

    // Career/orientation concerns
    if (motifKeys.some(m => ['orientation_carriere', 'choix_professionnel', 'epuisement_professionnel'].includes(m))) {
      if (professionKey === 'conseiller_orientation') {
        return {
          professionKey,
          labelFr,
          isEligible: true,
          reason: 'Spécialiste pour les questions de carrière et d\'orientation',
          priority: 'preferred',
        }
      }
    }

    // Sexual health concerns
    if (motifKeys.some(m => ['sexualite', 'intimite', 'dysfonction_sexuelle'].includes(m))) {
      if (professionKey === 'sexologue') {
        return {
          professionKey,
          labelFr,
          isEligible: true,
          reason: 'Spécialiste pour les questions de santé sexuelle',
          priority: 'preferred',
        }
      }
    }

    // Default: psychologue and psychotherapeute are preferred for general mental health
    if (['psychologue', 'psychotherapeute'].includes(professionKey)) {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: 'Adapté pour la plupart des consultations individuelles',
        priority: 'preferred',
      }
    }

    // Social workers are eligible
    if (professionKey === 'travailleur_social') {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: 'Peut accompagner pour les enjeux psychosociaux',
        priority: 'eligible',
      }
    }

    // Naturopathe is eligible for individual demands (but not preferred unless holistic signal)
    if (professionKey === 'naturopathe') {
      return {
        professionKey,
        labelFr,
        isEligible: true,
        reason: 'Peut accompagner pour les besoins de bien-être et équilibre de vie',
        priority: 'eligible',
      }
    }

    // Other professions eligible but not prioritized
    return {
      professionKey,
      labelFr,
      isEligible: true,
      reason: 'Peut intervenir selon la nature spécifique de la demande',
      priority: 'eligible',
    }
  }

  // Default fallback
  return {
    professionKey,
    labelFr,
    isEligible: true,
    reason: 'Disponible pour cette consultation',
    priority: 'eligible',
  }
}

// =============================================================================
// DATABASE STORAGE
// =============================================================================

interface StoreRecommendationsInput {
  demandeId: string
  demande: DemandeData
  config: RecommendationConfig
  holisticSignal: HolisticSignal
  recommendations: RecommendationProfessionalDetail[]
  exclusions: ExclusionRecord[]
  nearEligible: NearEligible[]
  aiOutput: AIAdvisoryOutput | null
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
    holisticSignal,
    recommendations,
    exclusions,
    nearEligible,
    aiOutput,
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

  // Build profession eligibility rules based on demand type and holistic signal
  const professionRules = buildProfessionEligibilityRules(demande, holisticSignal)

  // Build input snapshot (sanitized, no client PII)
  const inputSnapshot = {
    demandType: demande.demandType,
    urgencyLevel: demande.urgencyLevel,
    motifKeys: demande.motifKeys,
    populationCategories: demande.populationCategories,
    hasLegalContext: demande.hasLegalContext,
    holisticSignal: {
      score: holisticSignal.score,
      category: holisticSignal.category,
      matchedKeywords: holisticSignal.matchedKeywords,
      recommendNaturopath: holisticSignal.recommendNaturopath,
      hasClinicalOverride: holisticSignal.hasClinicalOverride,
    },
    configKey: config.key,
    candidateCount: recommendations.length,
    totalProfessionalsAnalyzed: exclusions.length + recommendations.length,
    professionRules,
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
      ai_summary_fr: aiOutput?.summaryFr || null,
      ai_extracted_preferences: aiOutput?.extractedPreferences || null,
      exclusions: exclusions,
      near_eligible: nearEligible,
      generated_by: profileId,
      model_version: getAIModelIdentifier(),
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
        processingTimeMs,
      },
    })

  if (auditError) {
    console.error('Failed to insert audit log:', auditError.message)
    // Continue anyway - audit logging is not critical
  }

  return { id: newRec.id }
}
