// src/recommendations/deterministic-scorer.ts
// Deterministic scoring calculations for professional recommendations.
// All scoring is reproducible, auditable, and requires no external API calls.

import type {
  CandidateData,
  DemandeData,
  RecommendationConfig,
  DeterministicScores,
  ExclusionRecord,
  NearEligible,
  ExclusionReasonCode,
} from './types'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of pre-filtering professionals by hard constraints.
 */
export interface PreFilterResult {
  /** Professionals who passed all hard constraints */
  eligible: CandidateData[]
  /** Records of why professionals were excluded */
  exclusions: ExclusionRecord[]
  /** Professionals who failed exactly one constraint (potential fallbacks) */
  nearEligible: NearEligible[]
}

/**
 * Constraint check result for a single constraint.
 */
interface ConstraintResult {
  passed: boolean
  reasonCode: ExclusionReasonCode
  reasonFr: string
  details?: Record<string, unknown>
}

// =============================================================================
// CONSTRAINT CHECKERS
// =============================================================================

/**
 * Check availability constraint: professional must have slots within the window.
 */
function checkAvailabilityConstraint(
  candidate: CandidateData,
  config: RecommendationConfig
): ConstraintResult {
  // If window is 0 or negative, availability is not required
  if (config.requireAvailabilityWithinDays <= 0) {
    return { passed: true, reasonCode: 'no_availability', reasonFr: '' }
  }

  const hasSlotsInWindow = candidate.availability.slotsInWindow > 0

  return {
    passed: hasSlotsInWindow,
    reasonCode: 'no_availability',
    reasonFr: `Aucune disponibilité dans les ${config.requireAvailabilityWithinDays} prochains jours`,
    details: {
      slotsAvailable: candidate.availability.slotsInWindow,
      hoursAvailable: candidate.availability.hoursAvailableInWindow,
      windowDays: config.requireAvailabilityWithinDays,
    },
  }
}

/**
 * Check motif overlap constraint: at least one motif must match.
 */
function checkMotifOverlapConstraint(
  candidate: CandidateData,
  demande: DemandeData,
  config: RecommendationConfig
): ConstraintResult {
  // If not required, always pass
  if (!config.requireMotifOverlap) {
    return { passed: true, reasonCode: 'no_motif_overlap', reasonFr: '' }
  }

  // If demande has no motifs selected, pass (nothing to match against)
  if (demande.motifKeys.length === 0) {
    return { passed: true, reasonCode: 'no_motif_overlap', reasonFr: '' }
  }

  const candidateMotifSet = new Set(candidate.motifs)
  const matchedMotifs = demande.motifKeys.filter((m) => candidateMotifSet.has(m))
  const hasOverlap = matchedMotifs.length > 0

  return {
    passed: hasOverlap,
    reasonCode: 'no_motif_overlap',
    reasonFr: 'Aucun des motifs demandés ne correspond à ce professionnel',
    details: {
      requestedMotifs: demande.motifKeys,
      professionalMotifs: candidate.motifs,
      matchedMotifs,
    },
  }
}

/**
 * Check population match constraint: professional must have specialty for client's age group.
 * Population specialties: 'children', 'adolescents', 'adults', 'seniors'
 */
function checkPopulationMatchConstraint(
  candidate: CandidateData,
  demande: DemandeData,
  config: RecommendationConfig
): ConstraintResult {
  // If not required, always pass
  if (!config.requirePopulationMatch) {
    return { passed: true, reasonCode: 'no_population_match', reasonFr: '' }
  }

  // If no population categories identified (e.g., birthdays not provided), pass
  if (demande.populationCategories.length === 0) {
    return { passed: true, reasonCode: 'no_population_match', reasonFr: '' }
  }

  // Population specialty codes map to population categories
  const populationSpecialtyCodes = new Set(['children', 'adolescents', 'adults', 'seniors'])
  const candidatePopulationSpecialties = candidate.specialties
    .filter((s) => populationSpecialtyCodes.has(s.code))
    .map((s) => s.code)

  // Check if any of the demande's population categories are covered
  const matchedPopulations = demande.populationCategories.filter((pop) =>
    candidatePopulationSpecialties.includes(pop)
  )
  const hasMatch = matchedPopulations.length > 0

  return {
    passed: hasMatch,
    reasonCode: 'no_population_match',
    reasonFr: `Spécialité requise pour la population demandée (${demande.populationCategories.join(', ')})`,
    details: {
      requiredPopulations: demande.populationCategories,
      candidatePopulationSpecialties,
      matchedPopulations,
    },
  }
}

/**
 * Check demand type specialty constraint.
 * - If demandType is 'couple', professional must have 'couples' specialty
 * - If demandType is 'family', professional must have 'families' specialty
 */
function checkDemandTypeSpecialtyConstraint(
  candidate: CandidateData,
  demande: DemandeData
): ConstraintResult {
  // Map demand types to required specialty codes
  const demandTypeToSpecialty: Record<string, string> = {
    couple: 'couples',
    family: 'families',
  }

  const requiredSpecialty = demandTypeToSpecialty[demande.demandType || '']

  // If demand type doesn't require a specialty, pass
  if (!requiredSpecialty) {
    return { passed: true, reasonCode: 'no_demand_type_specialty', reasonFr: '' }
  }

  const candidateSpecialtyCodes = new Set(candidate.specialties.map((s) => s.code))
  const hasRequiredSpecialty = candidateSpecialtyCodes.has(requiredSpecialty)

  return {
    passed: hasRequiredSpecialty,
    reasonCode: 'no_demand_type_specialty',
    reasonFr: `Spécialité "${requiredSpecialty}" requise pour les consultations de type "${demande.demandType}"`,
    details: {
      demandType: demande.demandType,
      requiredSpecialty,
      candidateSpecialties: [...candidateSpecialtyCodes],
    },
  }
}

/**
 * Run all constraint checks on a candidate.
 * Returns array of failed constraints (empty if all pass).
 */
function checkAllConstraints(
  candidate: CandidateData,
  demande: DemandeData,
  config: RecommendationConfig
): ConstraintResult[] {
  const results: ConstraintResult[] = []

  // 1. Availability check
  const availabilityResult = checkAvailabilityConstraint(candidate, config)
  if (!availabilityResult.passed) {
    results.push(availabilityResult)
  }

  // 2. Motif overlap check
  const motifResult = checkMotifOverlapConstraint(candidate, demande, config)
  if (!motifResult.passed) {
    results.push(motifResult)
  }

  // 3. Population match check
  const populationResult = checkPopulationMatchConstraint(candidate, demande, config)
  if (!populationResult.passed) {
    results.push(populationResult)
  }

  // 4. Demand type specialty check
  const demandTypeResult = checkDemandTypeSpecialtyConstraint(candidate, demande)
  if (!demandTypeResult.passed) {
    results.push(demandTypeResult)
  }

  return results
}

// =============================================================================
// SCORE CALCULATIONS
// =============================================================================

/**
 * Calculate motif match score.
 * Score = (matched motifs count / requested motifs count) * weight
 *
 * If no motifs requested, returns full weight (perfect match).
 */
function calculateMotifMatchScore(
  candidate: CandidateData,
  demande: DemandeData,
  config: RecommendationConfig
): { score: number; matchedMotifs: string[] } {
  if (demande.motifKeys.length === 0) {
    return { score: config.weightMotifMatch, matchedMotifs: [] }
  }

  const candidateMotifSet = new Set(candidate.motifs)
  const matchedMotifs = demande.motifKeys.filter((m) => candidateMotifSet.has(m))

  const ratio = matchedMotifs.length / demande.motifKeys.length
  const score = ratio * config.weightMotifMatch

  return { score, matchedMotifs }
}

/**
 * Calculate specialty match score.
 * Considers relevant specialties with proficiency weights:
 * - primary = 1.0
 * - secondary = 0.7
 * - familiar = 0.4
 *
 * Relevant specialties include:
 * - Population specialties matching demande
 * - Demand type specialties (couples, families)
 * - Issue-type specialties (anxiety, depression, etc.)
 * - Therapy-type specialties
 */
function calculateSpecialtyMatchScore(
  candidate: CandidateData,
  demande: DemandeData,
  config: RecommendationConfig
): { score: number; matchedSpecialties: string[] } {
  const proficiencyWeights: Record<string, number> = {
    primary: 1.0,
    secondary: 0.7,
    familiar: 0.4,
  }

  // Build set of relevant specialty codes based on demande
  const relevantSpecialties = new Set<string>()

  // Add population specialties
  for (const pop of demande.populationCategories) {
    relevantSpecialties.add(pop)
  }

  // Add demand type specialty
  if (demande.demandType === 'couple') {
    relevantSpecialties.add('couples')
  } else if (demande.demandType === 'family') {
    relevantSpecialties.add('families')
  }

  // Add legal/mediation specialty if applicable
  if (demande.hasLegalContext) {
    relevantSpecialties.add('mediation')
    relevantSpecialties.add('legal_context')
  }

  // If no relevant specialties identified, return base score
  if (relevantSpecialties.size === 0) {
    return { score: config.weightSpecialtyMatch * 0.5, matchedSpecialties: [] }
  }

  // Calculate weighted score for matched specialties
  let totalWeight = 0
  const matchedSpecialties: string[] = []

  for (const specialty of candidate.specialties) {
    if (relevantSpecialties.has(specialty.code)) {
      const proficiency = specialty.proficiencyLevel || 'familiar'
      const weight = proficiencyWeights[proficiency] ?? 0.4
      totalWeight += weight
      matchedSpecialties.push(specialty.code)
    }
  }

  // Normalize by number of relevant specialties
  const maxPossibleWeight = relevantSpecialties.size * 1.0 // Max if all were primary
  const ratio = maxPossibleWeight > 0 ? totalWeight / maxPossibleWeight : 0
  const score = Math.min(ratio, 1) * config.weightSpecialtyMatch

  return { score, matchedSpecialties }
}

/**
 * Calculate availability score.
 * Score = (available hours / max hours) * weight
 *
 * Hours are capped at config.availabilityMaxHours for normalization.
 */
function calculateAvailabilityScore(
  candidate: CandidateData,
  config: RecommendationConfig
): number {
  const availableHours = candidate.availability.hoursAvailableInWindow
  const normalizedHours = Math.min(availableHours, config.availabilityMaxHours)
  const ratio = normalizedHours / config.availabilityMaxHours
  return ratio * config.weightAvailability
}

/**
 * Calculate profession fit score.
 * Rule-based scoring:
 * - Legal context: favor travailleur_social (higher base score)
 * - Default: equal base score for all profession types
 */
function calculateProfessionFitScore(
  candidate: CandidateData,
  demande: DemandeData,
  config: RecommendationConfig
): number {
  const primaryProfession = candidate.professions.find((p) => p.isPrimary)
    || candidate.professions[0]

  if (!primaryProfession) {
    return config.weightProfessionFit * 0.5 // No profession, partial score
  }

  const professionCategory = primaryProfession.categoryKey

  // Base score for all professions
  let score = config.weightProfessionFit * 0.7

  // Legal context bonus for social workers
  if (demande.hasLegalContext) {
    if (professionCategory === 'travailleur_social') {
      score = config.weightProfessionFit * 1.0
    } else if (professionCategory === 'psychologue') {
      score = config.weightProfessionFit * 0.8
    }
    // Other professions keep base score
  }

  return score
}

/**
 * Calculate experience score.
 * Score = (years experience / max years) * weight
 *
 * Years are capped at config.experienceMaxYears for normalization.
 * Missing experience data results in half weight.
 */
function calculateExperienceScore(
  candidate: CandidateData,
  config: RecommendationConfig
): number {
  const yearsExperience = candidate.professional.yearsExperience

  if (yearsExperience === null || yearsExperience === undefined) {
    return config.weightExperience * 0.5 // Missing data, partial score
  }

  const normalizedYears = Math.min(yearsExperience, config.experienceMaxYears)
  const ratio = normalizedYears / config.experienceMaxYears
  return ratio * config.weightExperience
}

// =============================================================================
// MAIN SCORING FUNCTIONS
// =============================================================================

/**
 * Calculate all deterministic scores for a candidate.
 * Returns breakdown of all 5 score components plus total.
 *
 * Score ranges:
 * - Each component: 0 to its weight value
 * - Total: 0 to 1.0 (if weights sum to 1.0)
 */
export function calculateDeterministicScores(
  candidate: CandidateData,
  demande: DemandeData,
  config: RecommendationConfig
): DeterministicScores & { matchedMotifs: string[]; matchedSpecialties: string[] } {
  // Calculate each component
  const motifResult = calculateMotifMatchScore(candidate, demande, config)
  const specialtyResult = calculateSpecialtyMatchScore(candidate, demande, config)
  const availabilityScore = calculateAvailabilityScore(candidate, config)
  const professionFitScore = calculateProfessionFitScore(candidate, demande, config)
  const experienceScore = calculateExperienceScore(candidate, config)

  // Calculate total
  const totalScore =
    motifResult.score +
    specialtyResult.score +
    availabilityScore +
    professionFitScore +
    experienceScore

  return {
    motifMatchScore: motifResult.score,
    specialtyMatchScore: specialtyResult.score,
    availabilityScore,
    professionFitScore,
    experienceScore,
    totalScore,
    matchedMotifs: motifResult.matchedMotifs,
    matchedSpecialties: specialtyResult.matchedSpecialties,
  }
}

// =============================================================================
// PRE-FILTERING
// =============================================================================

/**
 * Pre-filter professionals by hard constraints and log exclusions.
 *
 * Each professional must pass ALL hard constraints to be eligible:
 * 1. Availability: Must have slots within configured window
 * 2. Motif overlap: At least 1 motif must match
 * 3. Population match: Must have specialty for client's age group
 * 4. Demand type specialty: Must have specialty for demand type (couple/family)
 *
 * Near-eligible tracking: Professionals who fail exactly 1 constraint are
 * tracked as potential fallbacks, with their would-be scores calculated.
 */
export function preFilterProfessionals(
  candidates: CandidateData[],
  demande: DemandeData,
  config: RecommendationConfig
): PreFilterResult {
  const eligible: CandidateData[] = []
  const exclusions: ExclusionRecord[] = []
  const nearEligible: NearEligible[] = []

  for (const candidate of candidates) {
    const failedConstraints = checkAllConstraints(candidate, demande, config)

    if (failedConstraints.length === 0) {
      // Passed all constraints - eligible
      eligible.push(candidate)
    } else if (failedConstraints.length === 1) {
      // Failed exactly one constraint - near-eligible
      // Using non-null assertion since we checked length === 1
      const failed = failedConstraints[0]!

      // Calculate what their scores would be
      const scores = calculateDeterministicScores(candidate, demande, config)

      nearEligible.push({
        professionalId: candidate.professional.id,
        missingConstraint: failed.reasonCode,
        scores: {
          motifMatchScore: scores.motifMatchScore,
          specialtyMatchScore: scores.specialtyMatchScore,
          availabilityScore: scores.availabilityScore,
          professionFitScore: scores.professionFitScore,
          experienceScore: scores.experienceScore,
          totalScore: scores.totalScore,
        },
        // Include next available date if excluded for availability
        nextAvailableDate: failed.reasonCode === 'no_availability'
          ? candidate.availability.nextSlotDatetime ?? undefined
          : undefined,
      })

      // Still record the exclusion
      exclusions.push({
        professionalId: candidate.professional.id,
        reasonCode: failed.reasonCode,
        reasonFr: failed.reasonFr,
        details: failed.details,
      })
    } else {
      // Failed multiple constraints - fully excluded
      // Record primary exclusion reason (first failed constraint)
      // Using non-null assertion since we know length > 1 from else branch
      const primaryFailure = failedConstraints[0]!

      exclusions.push({
        professionalId: candidate.professional.id,
        reasonCode: primaryFailure.reasonCode,
        reasonFr: primaryFailure.reasonFr,
        details: {
          ...primaryFailure.details,
          additionalFailures: failedConstraints.slice(1).map((f) => ({
            reasonCode: f.reasonCode,
            reasonFr: f.reasonFr,
          })),
        },
      })
    }
  }

  return { eligible, exclusions, nearEligible }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Sort candidates by total score (descending).
 */
export function sortByScore<T extends { totalScore: number }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => b.totalScore - a.totalScore)
}

/**
 * Get the count of matched motifs for a candidate.
 */
export function countMatchedMotifs(
  candidate: CandidateData,
  demande: DemandeData
): number {
  const candidateMotifSet = new Set(candidate.motifs)
  return demande.motifKeys.filter((m) => candidateMotifSet.has(m)).length
}

/**
 * Check if a candidate has any specialty from a list.
 */
export function hasAnySpecialty(
  candidate: CandidateData,
  specialtyCodes: string[]
): boolean {
  const candidateSpecialties = new Set(candidate.specialties.map((s) => s.code))
  return specialtyCodes.some((code) => candidateSpecialties.has(code))
}

/**
 * Get proficiency level for a specific specialty.
 */
export function getSpecialtyProficiency(
  candidate: CandidateData,
  specialtyCode: string
): string | null {
  const specialty = candidate.specialties.find((s) => s.code === specialtyCode)
  return specialty?.proficiencyLevel ?? null
}
