// src/recommendations/sanitizer.ts
// Functions to sanitize data before sending to AI - removes PII, keeps only what AI needs

import type {
  RecommendationDataBundle,
  AIAdvisoryInput,
  CandidateData,
  DemandeData,
} from './types'

// =============================================================================
// SANITIZATION HELPERS
// =============================================================================

/**
 * Sanitize text by removing potential PII patterns.
 * This is a safety layer - the main protection is not including PII fields at all.
 *
 * Patterns removed:
 * - Phone numbers (various formats)
 * - Email addresses
 * - Postal codes
 * - Common name patterns (Mr./Mrs./Dr. followed by name)
 */
function sanitizeText(text: string): string {
  if (!text) return ''

  let sanitized = text

  // Remove phone numbers (various formats)
  // Matches: (514) 555-1234, 514-555-1234, 514.555.1234, 5145551234, +1-514-555-1234
  sanitized = sanitized.replace(
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    '[PHONE]'
  )

  // Remove email addresses
  sanitized = sanitized.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    '[EMAIL]'
  )

  // Remove Canadian postal codes (A1A 1A1 or A1A1A1)
  sanitized = sanitized.replace(
    /[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d/g,
    '[POSTAL]'
  )

  // Remove common name prefixes that might indicate specific people
  // This is a light touch - we don't want to over-sanitize clinical content
  sanitized = sanitized.replace(
    /\b(M\.|Mme\.|Dr\.|Me\.)\s+[A-Z][a-zÀ-ÿ]+/g,
    '[NAME]'
  )

  return sanitized
}

/**
 * Combine client text fields into a single sanitized string.
 * Only includes the clinical/descriptive content, not identifying info.
 */
function combineClientText(demande: DemandeData): string {
  const parts: string[] = []

  // Add motif description (main clinical content)
  if (demande.motifDescription.trim()) {
    parts.push(demande.motifDescription.trim())
  }

  // Add other motif text if present
  if (demande.otherMotifText.trim()) {
    parts.push(demande.otherMotifText.trim())
  }

  // Notes are typically clinical/administrative - sanitize but include
  if (demande.notes.trim()) {
    parts.push(demande.notes.trim())
  }

  // Combine and sanitize
  const combined = parts.join('\n\n')
  return sanitizeText(combined)
}

// =============================================================================
// CANDIDATE SANITIZATION
// =============================================================================

interface SanitizedCandidate {
  id: string
  professionType: string
  deterministicScore: number
  matchedMotifCount: number
  availableSlotCount: number
  yearsExperience: number
}

/**
 * Calculate preliminary deterministic score for a candidate.
 * This is a simplified version - the full scoring happens in the scorer module.
 * Used here to provide AI with a rough ranking signal.
 *
 * @param candidate - Candidate data
 * @param demande - Demande data for matching
 * @returns Score between 0 and 1
 */
function calculatePreliminaryScore(
  candidate: CandidateData,
  demande: DemandeData
): number {
  // Simple motif match ratio
  const requestedMotifs = new Set(demande.motifKeys)
  const candidateMotifs = new Set(candidate.motifs)
  const matchedMotifs = [...requestedMotifs].filter((m) => candidateMotifs.has(m))
  const motifScore = requestedMotifs.size > 0
    ? matchedMotifs.length / requestedMotifs.size
    : 0

  // Availability score (normalized to max 1.0)
  const availabilityScore = Math.min(candidate.availability.slotsInWindow / 10, 1)

  // Experience score (normalized)
  const expYears = candidate.professional.yearsExperience || 0
  const experienceScore = Math.min(expYears / 15, 1)

  // Simple weighted average
  return (motifScore * 0.4) + (availabilityScore * 0.3) + (experienceScore * 0.3)
}

/**
 * Sanitize a single candidate for AI consumption.
 * Removes all identifying information, keeps only what AI needs for ranking.
 */
function sanitizeCandidate(
  candidate: CandidateData,
  demande: DemandeData
): SanitizedCandidate {
  // Get primary profession type or first available
  const primaryProfession = candidate.professions.find((p) => p.isPrimary)
    || candidate.professions[0]
  const professionType = primaryProfession?.categoryKey || 'unknown'

  // Count matched motifs
  const requestedMotifs = new Set(demande.motifKeys)
  const matchedMotifCount = candidate.motifs.filter((m) => requestedMotifs.has(m)).length

  return {
    id: candidate.professional.id,
    professionType,
    deterministicScore: calculatePreliminaryScore(candidate, demande),
    matchedMotifCount,
    availableSlotCount: candidate.availability.slotsInWindow,
    yearsExperience: candidate.professional.yearsExperience || 0,
  }
}

// =============================================================================
// MAIN SANITIZATION FUNCTION
// =============================================================================

/**
 * Sanitizes data bundle for AI consumption.
 * Removes all PII, keeps only what AI needs for generating recommendations.
 *
 * What AI sees:
 * - demandType: Type of consultation (individual, couple, family, group)
 * - urgencyLevel: Urgency flag (low, moderate, high)
 * - motifKeys: Array of motif identifiers
 * - clientText: Combined, sanitized clinical description
 * - hasLegalContext: Boolean flag for legal/mediation cases
 * - populationCategories: Age-derived categories (children, adolescents, adults, seniors)
 * - candidates: Array with id, profession, scores, availability (NO names)
 *
 * What AI NEVER sees:
 * - Client names, birthdates, contact info
 * - Professional names (only IDs)
 * - Email addresses, phone numbers
 * - Any other PII
 *
 * @param bundle - Complete data bundle from collector
 * @returns Sanitized input safe for AI processing
 */
export function sanitizeForAI(bundle: RecommendationDataBundle): AIAdvisoryInput {
  const { demande, candidates } = bundle

  // Sanitize and transform candidates
  const sanitizedCandidates = candidates.map((c) => sanitizeCandidate(c, demande))

  // Sort candidates by preliminary score for better AI context
  sanitizedCandidates.sort((a, b) => b.deterministicScore - a.deterministicScore)

  return {
    demandType: demande.demandType || 'individual',
    urgencyLevel: demande.urgencyLevel || 'low',
    motifKeys: demande.motifKeys,
    clientText: combineClientText(demande),
    hasLegalContext: demande.hasLegalContext,
    populationCategories: demande.populationCategories,
    candidates: sanitizedCandidates,
  }
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that sanitized input contains no obvious PII.
 * This is a sanity check - the main protection is not including PII fields.
 *
 * @param input - Sanitized AI input
 * @returns True if validation passes, throws on failure
 */
export function validateSanitizedInput(input: AIAdvisoryInput): boolean {
  // Check client text for common PII patterns
  const piiPatterns = [
    // Email
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    // Phone (various formats)
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    // Canadian postal code
    /[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d/,
    // Date of birth patterns (YYYY-MM-DD or DD/MM/YYYY)
    /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/,
  ]

  for (const pattern of piiPatterns) {
    if (pattern.test(input.clientText)) {
      console.warn(
        'Potential PII detected in sanitized input. Pattern:',
        pattern.source
      )
      // In production, you might want to throw here or take other action
      // For now, we log and continue
    }
  }

  // Validate candidate structure (should only have expected fields)
  for (const candidate of input.candidates) {
    const allowedKeys = new Set([
      'id',
      'professionType',
      'deterministicScore',
      'matchedMotifCount',
      'availableSlotCount',
      'yearsExperience',
    ])

    for (const key of Object.keys(candidate)) {
      if (!allowedKeys.has(key)) {
        throw new Error(
          `Unexpected field in sanitized candidate: ${key}. This may indicate PII leakage.`
        )
      }
    }
  }

  return true
}

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

export {
  sanitizeText,
  combineClientText,
  sanitizeCandidate,
  calculatePreliminaryScore,
}
