// src/recommendations/holistic-classifier.ts
// Classifies client text to detect holistic/body/wellness intent for naturopath recommendations

export type HolisticCategory = 'body' | 'energy' | 'lifestyle' | 'global' | 'none'

export interface HolisticSignal {
  /** Score 0-1, higher = stronger holistic intent */
  score: number
  /** Keywords found in client text */
  matchedKeywords: string[]
  /** Primary category detected */
  category: HolisticCategory
  /** true if score > 0.5 AND no clinical override */
  recommendNaturopath: boolean
  /** true if crisis/trauma keywords detected */
  hasClinicalOverride: boolean
  /** Clinical keywords found (if any) */
  clinicalKeywordsFound: string[]
}

/**
 * Keywords that indicate holistic/body/wellness needs.
 * Grouped by category for scoring and display.
 */
export const HOLISTIC_KEYWORDS: Record<Exclude<HolisticCategory, 'none'>, string[]> = {
  body: [
    'corps',
    'digestion',
    'intestin',
    'alimentation',
    'poids',
    'physique',
    'douleur',
    'tension',
    'posture',
    'nutrition',
    'diète',
    'métabolisme',
  ],
  energy: [
    'énergie',
    'fatigue',
    'sommeil',
    'épuisement',
    'hormones',
    'vitalité',
    'burnout',
    'insomnie',
    'réveil',
    'endormissement',
    'cycles',
    'ménopause',
    'thyroïde',
  ],
  lifestyle: [
    'habitudes de vie',
    'équilibre de vie',
    'routine',
    'mode de vie',
    'stress chronique',
    'hygiène de vie',
    'rythme de vie',
    'organisation quotidienne',
  ],
  global: [
    'approche globale',
    'holistique',
    'naturel',
    'bien-être',
    'naturopathie',
    'santé naturelle',
    'médecine douce',
    'complémentaire',
    'prévention',
    // Note: 'équilibre' removed - too generic, 'équilibre de vie' is in lifestyle
  ],
}

/**
 * Keywords that indicate clinical crisis - must override holistic recommendation.
 * When these are present, psychologue/psychothérapeute should remain preferred.
 */
export const CLINICAL_OVERRIDE_KEYWORDS: string[] = [
  'idées noires',
  'suicidaire',
  'suicide',
  'crise',
  'trauma',
  'traumatisme',
  'détresse importante',
  'détresse sévère',
  'violence',
  'urgence',
  'danger',
  'automutilation',
  'psychose',
  'hallucination',
  'délire',
  'dissociation',
  'panique',
  'attaque de panique',
  'abus',
  'agression',
]

/**
 * Normalize text for keyword matching.
 * Lowercase, remove accents, normalize whitespace.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Check if text contains a keyword (case-insensitive, accent-insensitive).
 * For single words, checks partial word match (e.g., "suicidaire" matches "suicidaires").
 * For phrases, checks exact phrase match.
 */
function containsKeyword(normalizedText: string, keyword: string): boolean {
  const normalizedKeyword = normalizeText(keyword)
  const escapedKeyword = escapeRegex(normalizedKeyword)

  // Use word boundary check for phrases, partial match for single words
  if (normalizedKeyword.includes(' ')) {
    // For phrases, require exact phrase match
    return normalizedText.includes(normalizedKeyword)
  }

  // For single words, allow partial match (e.g., "suicidaire" matches "suicidaires")
  // This handles French word variations
  const regex = new RegExp(`\\b${escapedKeyword}`, 'i')
  return regex.test(normalizedText)
}

/**
 * Find all matching keywords from a list in the given text.
 */
function findMatchingKeywords(normalizedText: string, keywords: string[]): string[] {
  return keywords.filter((keyword) => containsKeyword(normalizedText, keyword))
}

/**
 * Determine the primary category based on matched keywords.
 */
function determinePrimaryCategory(
  matchesByCategory: Record<Exclude<HolisticCategory, 'none'>, string[]>
): HolisticCategory {
  const categories: Array<Exclude<HolisticCategory, 'none'>> = ['global', 'lifestyle', 'energy', 'body']

  // Priority: global > lifestyle > energy > body
  // Global is highest because "approche globale" is explicit intent
  for (const category of categories) {
    if (matchesByCategory[category].length > 0) {
      return category
    }
  }

  return 'none'
}

/**
 * Calculate holistic score based on keyword matches.
 * Score is weighted: more categories = higher score, more keywords = higher score.
 */
function calculateScore(matchesByCategory: Record<Exclude<HolisticCategory, 'none'>, string[]>): number {
  const categoryWeights: Record<Exclude<HolisticCategory, 'none'>, number> = {
    global: 0.4,    // Explicit "approche globale" is strong signal
    lifestyle: 0.3, // Lifestyle signals are moderate
    energy: 0.2,    // Energy/fatigue could be psych or naturo
    body: 0.2,      // Body signals suggest naturo
  }

  let totalScore = 0
  let categoriesWithMatches = 0

  for (const category of Object.keys(categoryWeights) as Array<Exclude<HolisticCategory, 'none'>>) {
    const matches = matchesByCategory[category]
    if (matches.length > 0) {
      categoriesWithMatches++
      // Each category contributes its weight, boosted slightly by number of matches
      const matchBoost = Math.min(matches.length * 0.1, 0.3) // Cap boost at 0.3
      totalScore += categoryWeights[category] + matchBoost
    }
  }

  // Bonus for multiple category matches (indicates comprehensive holistic need)
  if (categoriesWithMatches >= 2) {
    totalScore += 0.15
  }
  if (categoriesWithMatches >= 3) {
    totalScore += 0.1
  }

  // Normalize to 0-1 range
  return Math.min(totalScore, 1)
}

/**
 * Classify client text to detect holistic/body/wellness intent.
 *
 * @param text - Combined client text (besoinRaison, motifDescription, enjeuxDemarche)
 * @returns HolisticSignal with score, category, and recommendation
 *
 * @example
 * // Strong holistic signal
 * classifyHolisticIntent("approche globale / corps / digestion / sommeil / énergie")
 * // => { score: 0.85, category: 'global', recommendNaturopath: true, ... }
 *
 * @example
 * // Clinical override (crisis keywords present)
 * classifyHolisticIntent("fatigue / épuisement / idées noires / détresse importante")
 * // => { score: 0.4, category: 'energy', recommendNaturopath: false, hasClinicalOverride: true, ... }
 *
 * @example
 * // No holistic signal
 * classifyHolisticIntent("stress relationnel / conflits / communication")
 * // => { score: 0, category: 'none', recommendNaturopath: false, ... }
 */
export function classifyHolisticIntent(text: string): HolisticSignal {
  if (!text || text.trim().length === 0) {
    return {
      score: 0,
      matchedKeywords: [],
      category: 'none',
      recommendNaturopath: false,
      hasClinicalOverride: false,
      clinicalKeywordsFound: [],
    }
  }

  const normalizedText = normalizeText(text)

  // Find holistic keyword matches by category
  const matchesByCategory: Record<Exclude<HolisticCategory, 'none'>, string[]> = {
    body: findMatchingKeywords(normalizedText, HOLISTIC_KEYWORDS.body),
    energy: findMatchingKeywords(normalizedText, HOLISTIC_KEYWORDS.energy),
    lifestyle: findMatchingKeywords(normalizedText, HOLISTIC_KEYWORDS.lifestyle),
    global: findMatchingKeywords(normalizedText, HOLISTIC_KEYWORDS.global),
  }

  // Flatten all matched keywords
  const allMatchedKeywords = [
    ...matchesByCategory.body,
    ...matchesByCategory.energy,
    ...matchesByCategory.lifestyle,
    ...matchesByCategory.global,
  ]

  // Check for clinical override keywords
  const clinicalKeywordsFound = findMatchingKeywords(normalizedText, CLINICAL_OVERRIDE_KEYWORDS)
  const hasClinicalOverride = clinicalKeywordsFound.length > 0

  // Calculate score and determine category
  const score = calculateScore(matchesByCategory)
  const category = determinePrimaryCategory(matchesByCategory)

  // Recommend naturopath only if:
  // 1. Score is above threshold (0.5)
  // 2. No clinical override (crisis keywords)
  const recommendNaturopath = score >= 0.5 && !hasClinicalOverride

  return {
    score,
    matchedKeywords: allMatchedKeywords,
    category,
    recommendNaturopath,
    hasClinicalOverride,
    clinicalKeywordsFound,
  }
}

/**
 * Create an empty/default holistic signal (for when no text is available).
 */
export function createEmptyHolisticSignal(): HolisticSignal {
  return {
    score: 0,
    matchedKeywords: [],
    category: 'none',
    recommendNaturopath: false,
    hasClinicalOverride: false,
    clinicalKeywordsFound: [],
  }
}
