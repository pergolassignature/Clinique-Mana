// src/recommendations/schedule-interpreter.ts
// Schedule Interpreter for Free-Text Schedule Preferences
//
// This module uses a minimal LLM call to interpret free-text schedule preferences
// when the user selects "other" (autre) for their schedule preference.
//
// Called ONLY when `schedule_preference = 'other'`. Transforms the free-text
// `schedule_preference_detail` into structured filters that can be applied
// to availability slots.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// =============================================================================
// CONSTANTS
// =============================================================================

/** Claude model to use for schedule interpretation (same as ai-advisory) */
const AI_MODEL = 'claude-sonnet-4-20250514'

/** Maximum tokens for the response (small, focused output) */
const MAX_TOKENS = 512

// =============================================================================
// TYPES
// =============================================================================

/** Days of the week in English (database format) */
export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

/**
 * Time range in HH:mm format.
 */
export interface TimeRange {
  start: string // HH:mm format
  end: string // HH:mm format
}

/**
 * Structured filter extracted from free-text schedule preference.
 * Used to filter availability slots.
 */
export interface ScheduleFilter {
  /** Days of the week to include, or null to include all days */
  days: DayOfWeek[] | null
  /** Time ranges to include, or null to include all times */
  timeRanges: TimeRange[] | null
  /** Human-readable explanation in French */
  explanation: string
}

/**
 * Input for the schedule interpreter.
 */
export interface InterpretScheduleInput {
  /** The free-text schedule preference from the user */
  schedulePreferenceDetail: string
}

/**
 * Options for the schedule interpreter function.
 */
export interface InterpretScheduleOptions {
  /** Custom Anthropic client (for testing or custom configuration) */
  client?: Anthropic
  /** Override the API key (defaults to env variable) */
  apiKey?: string
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Result of schedule interpretation including metadata.
 */
export interface InterpretScheduleResult {
  success: boolean
  filter: ScheduleFilter
  modelUsed: string
  processingTimeMs: number
  error?: string
}

// =============================================================================
// SCHEMAS
// =============================================================================

const DayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
])

const TimeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format'),
})

const ScheduleFilterSchema = z.object({
  days: z.array(DayOfWeekSchema).nullable(),
  timeRanges: z.array(TimeRangeSchema).nullable(),
  explanation: z.string(),
})

// =============================================================================
// PROMPT
// =============================================================================

const SYSTEM_PROMPT = `Tu es un assistant qui analyse les préférences horaires des clients d'une clinique de santé mentale.

Ta tâche est d'extraire des filtres structurés à partir d'une description en texte libre des disponibilités du client.

IMPORTANT:
- Retourne UNIQUEMENT du JSON valide, sans texte additionnel
- Les jours doivent être en anglais minuscule: monday, tuesday, wednesday, thursday, friday, saturday, sunday
- Les heures doivent être au format HH:mm (24h)
- Si une contrainte n'est pas mentionnée, utilise null pour ce champ
- L'explication doit être en français, concise (1-2 phrases max)

Format de sortie:
{
  "days": ["monday", "tuesday", ...] ou null,
  "timeRanges": [{"start": "09:00", "end": "12:00"}, ...] ou null,
  "explanation": "Explication en français"
}`

function buildUserPrompt(schedulePreferenceDetail: string): string {
  return `Le client a indiqué cette préférence horaire: "${schedulePreferenceDetail}"

Analyse cette préférence et retourne un JSON avec les filtres à appliquer.`
}

// =============================================================================
// NEUTRAL OUTPUT (FALLBACK)
// =============================================================================

/**
 * Create a neutral filter that doesn't exclude anything.
 * Used when AI is unavailable or fails to parse the preference.
 */
function createNeutralFilter(reason?: string): ScheduleFilter {
  return {
    days: null,
    timeRanges: null,
    explanation: reason || "Impossible d'interpréter la préférence horaire",
  }
}

// =============================================================================
// RESPONSE PARSING & VALIDATION
// =============================================================================

/**
 * Parse and validate the AI response.
 * Handles JSON extraction from potentially wrapped responses.
 */
function parseAIResponse(responseText: string): ScheduleFilter {
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
    console.error(
      'Failed to parse schedule interpreter response as JSON:',
      jsonStr.substring(0, 200)
    )
    throw new Error('Invalid JSON in AI response')
  }

  // Validate against schema
  const validated = ScheduleFilterSchema.safeParse(parsed)
  if (!validated.success) {
    console.error(
      'Schedule filter validation failed:',
      validated.error.issues
    )
    throw new Error(
      `Schedule filter validation failed: ${validated.error.issues[0]?.message}`
    )
  }

  return validated.data
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Interpret free-text schedule preference and return structured filters.
 *
 * This function is designed to fail gracefully - if the AI call fails for any reason,
 * it returns a neutral filter that doesn't exclude any availability slots.
 *
 * @param input - The schedule preference detail text
 * @param options - Optional configuration
 * @returns Structured schedule filter
 */
export async function interpretSchedule(
  input: InterpretScheduleInput,
  options: InterpretScheduleOptions = {}
): Promise<InterpretScheduleResult> {
  const startTime = Date.now()
  const { debug = false } = options

  // If no input text, return neutral filter
  if (!input.schedulePreferenceDetail?.trim()) {
    return {
      success: true,
      filter: createNeutralFilter('Aucune préférence horaire spécifiée'),
      modelUsed: AI_MODEL,
      processingTimeMs: Date.now() - startTime,
    }
  }

  // Get API key
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.warn(
      'ANTHROPIC_API_KEY not set - returning neutral schedule filter'
    )
    return {
      success: false,
      filter: createNeutralFilter("Clé API non configurée"),
      modelUsed: AI_MODEL,
      processingTimeMs: Date.now() - startTime,
      error: 'API key not configured',
    }
  }

  // Initialize Anthropic client
  const client = options.client || new Anthropic({ apiKey })

  // Build prompt
  const userPrompt = buildUserPrompt(input.schedulePreferenceDetail)

  if (debug) {
    console.log('=== Schedule Interpreter Debug ===')
    console.log('Input:', input.schedulePreferenceDetail)
    console.log('User prompt length:', userPrompt.length)
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
      system: SYSTEM_PROMPT,
    })

    // Extract text response
    const textContent = response.content.find((block) => block.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in AI response')
    }

    const responseText = textContent.text

    if (debug) {
      console.log('AI response:', responseText)
      console.log('Stop reason:', response.stop_reason)
    }

    // Parse and validate response
    const filter = parseAIResponse(responseText)

    return {
      success: true,
      filter,
      modelUsed: AI_MODEL,
      processingTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    // Log the error but don't fail the process
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Schedule interpreter call failed:', errorMessage)

    return {
      success: false,
      filter: createNeutralFilter(),
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
 * Check if a slot matches the schedule filter.
 *
 * @param slotDay - Day of week for the slot (lowercase English)
 * @param slotStartTime - Start time of the slot in HH:mm format
 * @param filter - The schedule filter to apply
 * @returns true if the slot matches the filter criteria
 */
export function slotMatchesFilter(
  slotDay: DayOfWeek,
  slotStartTime: string,
  filter: ScheduleFilter
): boolean {
  // Check day filter
  if (filter.days !== null && !filter.days.includes(slotDay)) {
    return false
  }

  // Check time filter
  if (filter.timeRanges !== null) {
    const slotMinutes = timeToMinutes(slotStartTime)
    const matchesAnyRange = filter.timeRanges.some((range) => {
      const startMinutes = timeToMinutes(range.start)
      const endMinutes = timeToMinutes(range.end)
      return slotMinutes >= startMinutes && slotMinutes < endMinutes
    })
    if (!matchesAnyRange) {
      return false
    }
  }

  return true
}

/**
 * Convert HH:mm time string to minutes since midnight.
 */
function timeToMinutes(time: string): number {
  const parts = time.split(':').map(Number)
  const hours = parts[0] ?? 0
  const minutes = parts[1] ?? 0
  return hours * 60 + minutes
}

/**
 * Check if schedule interpretation is available (API key configured).
 */
export function isScheduleInterpretationAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
