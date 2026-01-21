// src/recommendations/ai-advisory.ts
// AI Advisory Layer for Professional Recommendations
//
// This module handles the AI-assisted portion of recommendation generation.
// AI is used ONLY for:
// 1. Text analysis: Extract timing preferences from client text
// 2. Contextual ranking: Minor adjustments (-5 to +5) based on nuanced fit
// 3. Explanation generation: Structured bullet points explaining the match
//
// AI does NOT:
// - Compute scores (all deterministic)
// - Access raw client data (input is sanitized)
// - Make final decisions (advisory only)

import Anthropic from '@anthropic-ai/sdk'
import type {
  AIAdvisoryInput,
  AIAdvisoryOutput,
  RecommendationConfig,
} from './types'
import { AIAdvisoryOutputSchema } from './types'
import {
  buildUserPrompt,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT_TEMPLATE,
} from './prompts/build-prompt'

// =============================================================================
// CONSTANTS
// =============================================================================

/** Claude model to use for advisory analysis */
const AI_MODEL = 'claude-sonnet-4-20250514'

/** Maximum tokens for the response */
const MAX_TOKENS = 2048

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for the AI advisory function.
 */
export interface AIAdvisoryOptions {
  /** Custom Anthropic client (for testing or custom configuration) */
  client?: Anthropic
  /** Override the API key (defaults to env variable) */
  apiKey?: string
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Result of AI advisory call including metadata.
 */
export interface AIAdvisoryResult {
  success: boolean
  output: AIAdvisoryOutput
  modelUsed: string
  processingTimeMs: number
  error?: string
}

// =============================================================================
// NEUTRAL OUTPUT (FALLBACK)
// =============================================================================

/**
 * Create a neutral/empty output for when AI is unavailable or fails.
 * This allows the system to continue with deterministic-only recommendations.
 */
function createNeutralOutput(candidates: AIAdvisoryInput['candidates']): AIAdvisoryOutput {
  return {
    extractedPreferences: {
      preferredTiming: undefined,
      preferredModality: undefined,
      otherConstraints: [],
    },
    rankings: candidates.map((c) => ({
      professionalId: c.id,
      rankingAdjustment: 0,
      reasoningBullets: ['Analyse IA non disponible - classement basé uniquement sur les scores déterministes.'],
    })),
    summaryFr: 'Recommandations basées uniquement sur les critères déterministes (correspondance de motifs, disponibilité, spécialités).',
  }
}

// =============================================================================
// RESPONSE PARSING & VALIDATION
// =============================================================================

/**
 * Parse and validate the AI response.
 * Handles JSON extraction from potentially wrapped responses.
 */
function parseAIResponse(
  responseText: string,
  candidates: AIAdvisoryInput['candidates']
): AIAdvisoryOutput {
  // Try to extract JSON from the response
  let jsonStr = responseText.trim()

  // Handle case where response is wrapped in markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (jsonMatch?.[1]) {
    jsonStr = jsonMatch[1].trim()
  }

  // Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    console.error('Failed to parse AI response as JSON:', jsonStr.substring(0, 200))
    throw new Error('Invalid JSON in AI response')
  }

  // Validate against schema
  const validated = AIAdvisoryOutputSchema.safeParse(parsed)
  if (!validated.success) {
    console.error('AI response validation failed:', validated.error.issues)
    throw new Error(`AI response validation failed: ${validated.error.issues[0]?.message}`)
  }

  // Post-validation: ensure all candidate IDs are present
  const validatedOutput = validated.data
  const candidateIds = new Set(candidates.map((c) => c.id))
  const responseIds = new Set(validatedOutput.rankings.map((r) => r.professionalId))

  // Add missing candidates with neutral adjustments
  for (const candidate of candidates) {
    if (!responseIds.has(candidate.id)) {
      validatedOutput.rankings.push({
        professionalId: candidate.id,
        rankingAdjustment: 0,
        reasoningBullets: ['Candidat non analysé par l\'IA - score déterministe conservé.'],
      })
    }
  }

  // Remove any extra candidates not in the input
  validatedOutput.rankings = validatedOutput.rankings.filter((r) =>
    candidateIds.has(r.professionalId)
  )

  // Clamp ranking adjustments to valid range
  for (const ranking of validatedOutput.rankings) {
    ranking.rankingAdjustment = Math.max(-5, Math.min(5, ranking.rankingAdjustment))
  }

  return validatedOutput
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Call Claude API for advisory analysis.
 * Returns structured output with preferences, adjustments, and reasoning.
 *
 * This function is designed to fail gracefully - if the AI call fails for any reason,
 * it returns a neutral output that allows the system to continue with deterministic-only
 * recommendations.
 *
 * @param input - Sanitized AI advisory input (no PII)
 * @param config - Recommendation configuration with prompts
 * @param options - Optional configuration
 * @returns Structured advisory output
 */
export async function getAIAdvisory(
  input: AIAdvisoryInput,
  config: RecommendationConfig,
  options: AIAdvisoryOptions = {}
): Promise<AIAdvisoryResult> {
  const startTime = Date.now()
  const { debug = false } = options

  // If no candidates, return empty result
  if (input.candidates.length === 0) {
    return {
      success: true,
      output: createNeutralOutput([]),
      modelUsed: AI_MODEL,
      processingTimeMs: Date.now() - startTime,
    }
  }

  // Get API key
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set - returning neutral AI output')
    return {
      success: false,
      output: createNeutralOutput(input.candidates),
      modelUsed: AI_MODEL,
      processingTimeMs: Date.now() - startTime,
      error: 'API key not configured',
    }
  }

  // Initialize Anthropic client
  const client = options.client || new Anthropic({ apiKey })

  // Build prompts
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT
  const userPromptTemplate = config.userPromptTemplate || DEFAULT_USER_PROMPT_TEMPLATE
  const userPrompt = buildUserPrompt(input, userPromptTemplate)

  if (debug) {
    console.log('=== AI Advisory Debug ===')
    console.log('System prompt length:', systemPrompt.length)
    console.log('User prompt length:', userPrompt.length)
    console.log('Candidates:', input.candidates.length)
  }

  try {
    // Call Claude API
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      system: systemPrompt,
    })

    // Extract text response
    const textContent = response.content.find((block) => block.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in AI response')
    }

    const responseText = textContent.text

    if (debug) {
      console.log('AI response length:', responseText.length)
      console.log('Stop reason:', response.stop_reason)
    }

    // Parse and validate response
    const output = parseAIResponse(responseText, input.candidates)

    return {
      success: true,
      output,
      modelUsed: AI_MODEL,
      processingTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    // Log the error but don't fail the recommendation process
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('AI advisory call failed:', errorMessage)

    return {
      success: false,
      output: createNeutralOutput(input.candidates),
      modelUsed: AI_MODEL,
      processingTimeMs: Date.now() - startTime,
      error: errorMessage,
    }
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if AI advisory is available (API key configured).
 */
export function isAIAdvisoryAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Get the model identifier used for AI advisory.
 */
export function getAIModelIdentifier(): string {
  return AI_MODEL
}

/**
 * Apply AI ranking adjustments to a list of scored candidates.
 * Returns candidates sorted by adjusted score.
 *
 * @param candidates - Candidates with deterministic scores
 * @param aiOutput - AI advisory output with adjustments
 * @returns Candidates with adjusted scores, sorted descending
 */
export function applyAIAdjustments<
  T extends { professionalId: string; totalScore: number }
>(
  candidates: T[],
  aiOutput: AIAdvisoryOutput
): Array<T & { aiAdjustment: number; adjustedScore: number }> {
  // Create lookup map for AI adjustments
  const adjustmentMap = new Map<string, number>()
  for (const ranking of aiOutput.rankings) {
    adjustmentMap.set(ranking.professionalId, ranking.rankingAdjustment)
  }

  // Apply adjustments
  const adjusted = candidates.map((c) => {
    const aiAdjustment = adjustmentMap.get(c.professionalId) ?? 0
    // AI adjustment is a modifier on the total score
    // Scale adjustment to be proportional to score magnitude
    const adjustedScore = c.totalScore + (aiAdjustment * 0.1) // 0.1 scaling factor
    return {
      ...c,
      aiAdjustment,
      adjustedScore,
    }
  })

  // Sort by adjusted score descending
  return adjusted.sort((a, b) => b.adjustedScore - a.adjustedScore)
}

/**
 * Get reasoning bullets for a specific professional from AI output.
 */
export function getReasoningForProfessional(
  professionalId: string,
  aiOutput: AIAdvisoryOutput
): string[] {
  const ranking = aiOutput.rankings.find((r) => r.professionalId === professionalId)
  return ranking?.reasoningBullets ?? []
}
