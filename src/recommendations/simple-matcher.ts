// src/recommendations/simple-matcher.ts
// Simplified professional matching system for recommendations.
// Replaces the complex LLM-based scoring with deterministic filtering and scoring.

import { supabase } from '@/lib/supabaseClient'
import { calculateAge } from './data-collector'
import type { CandidateData } from './types'

// =============================================================================
// TYPES
// =============================================================================

export type AgeCategory = 'children' | 'adolescents' | 'adults' | 'seniors'
export type DemandType = 'individual' | 'couple' | 'family' | 'group' | null
export type SchedulePreference = 'am' | 'pm' | 'evening' | 'weekend' | 'other'

/**
 * Input for the simple matcher.
 */
export interface SimpleMatcherInput {
  demande: {
    id: string
    demandType: DemandType
    selectedMotifs: string[]
    schedulePreferences: SchedulePreference[] // Array of preferences (empty = no filtering)
    schedulePreferenceDetail: string | null
  }
  primaryClient: {
    id: string
    birthday: string | null // YYYY-MM-DD
  }
}

/**
 * Information about an available time slot.
 */
export interface AvailableSlotInfo {
  date: string // YYYY-MM-DD
  startTime: string // ISO datetime
  endTime: string // ISO datetime
  blockId: string
}

/**
 * A professional that matched the criteria.
 */
export interface MatchedProfessional {
  professionalId: string
  displayName: string
  professionTitles: string[]
  motifScore: number // 0-1
  matchedMotifs: string[]
  unmatchedMotifs: string[]
  availableSlots: AvailableSlotInfo[]
  availableSlotsCount: number
  nextAvailableSlot: string | null // ISO datetime
}

/**
 * Result from the simple matcher.
 */
export interface SimpleMatcherResult {
  professionals: MatchedProfessional[]
  totalEvaluated: number
  filteredByClientele: number
  filteredByAvailability: number
}

// =============================================================================
// AGE CATEGORY HELPERS
// =============================================================================

/**
 * Get age category from birthday.
 * Returns 'adults' as default if birthday is null or invalid.
 */
export function getAgeCategory(birthday: string | null): AgeCategory {
  const age = calculateAge(birthday)
  if (age === null) return 'adults' // Default to adults if no birthday

  if (age <= 12) return 'children'
  if (age <= 17) return 'adolescents'
  if (age <= 64) return 'adults'
  return 'seniors'
}

// =============================================================================
// CLIENTELE FILTERING (HARD FILTER)
// =============================================================================

/**
 * Map demand type to required specialty code.
 */
const DEMAND_TYPE_TO_SPECIALTY: Record<string, string> = {
  couple: 'couples',
  family: 'families',
  group: 'groups',
}

/**
 * Check if a professional can serve the clientele based on demand type and age.
 * This is a HARD FILTER - no match = excluded.
 *
 * Rules:
 * - If demandType is 'couple' → professional MUST have 'couples' specialty
 * - If demandType is 'family' → professional MUST have 'families' specialty
 * - If demandType is 'group' → professional MUST have 'groups' specialty
 * - Otherwise → professional MUST have the age category specialty
 */
export function canServeClientele(
  candidate: CandidateData,
  demandType: DemandType,
  ageCategory: AgeCategory
): boolean {
  const specialtyCodes = new Set(candidate.specialties.map((s) => s.code))

  // Check demand type specialty requirement
  if (demandType && demandType !== 'individual') {
    const requiredSpecialty = DEMAND_TYPE_TO_SPECIALTY[demandType]
    if (requiredSpecialty) {
      return specialtyCodes.has(requiredSpecialty)
    }
  }

  // For individual or no specific demand type, check age category
  return specialtyCodes.has(ageCategory)
}

// =============================================================================
// MOTIF SCORING
// =============================================================================

/**
 * Calculate motif match score between demande and professional.
 * Returns score between 0-1.
 *
 * If demande has no selected motifs, returns 1 (perfect match - no requirements).
 */
export function calculateMotifScore(
  demandeMotifs: string[],
  professionalMotifs: string[]
): { score: number; matched: string[]; unmatched: string[] } {
  // No motifs requested = perfect match
  if (demandeMotifs.length === 0) {
    return { score: 1, matched: [], unmatched: [] }
  }

  const proMotifSet = new Set(professionalMotifs)
  const matched = demandeMotifs.filter((m) => proMotifSet.has(m))
  const unmatched = demandeMotifs.filter((m) => !proMotifSet.has(m))

  const score = matched.length / demandeMotifs.length

  return { score, matched, unmatched }
}

// =============================================================================
// AVAILABILITY FILTERING
// =============================================================================

/**
 * Database row type for availability blocks.
 */
interface DbAvailabilityBlock {
  id: string
  professional_id: string
  start_time: string
  end_time: string
  type: string
}

/**
 * Fetch availability blocks for multiple professionals within a date range.
 */
async function fetchAvailabilityBlocks(
  professionalIds: string[],
  startDate: string,
  endDate: string
): Promise<Map<string, DbAvailabilityBlock[]>> {
  if (professionalIds.length === 0) {
    return new Map()
  }

  const { data, error } = await supabase
    .from('availability_blocks')
    .select('id, professional_id, start_time, end_time, type')
    .in('professional_id', professionalIds)
    .eq('type', 'available')
    .gte('start_time', `${startDate}T00:00:00`)
    .lte('end_time', `${endDate}T23:59:59`)
    .order('start_time', { ascending: true })

  if (error) {
    console.error('Failed to fetch availability blocks:', error.message)
    return new Map()
  }

  // Group blocks by professional
  const blocksByProfessional = new Map<string, DbAvailabilityBlock[]>()
  for (const block of data || []) {
    const existing = blocksByProfessional.get(block.professional_id) || []
    existing.push(block)
    blocksByProfessional.set(block.professional_id, existing)
  }

  return blocksByProfessional
}

/**
 * Fetch appointments that would occupy slots for multiple professionals.
 */
async function fetchBookedAppointments(
  professionalIds: string[],
  startDate: string,
  endDate: string
): Promise<Map<string, Array<{ start_time: string; duration_minutes: number }>>> {
  if (professionalIds.length === 0) {
    return new Map()
  }

  const { data, error } = await supabase
    .from('appointments')
    .select('professional_id, start_time, duration_minutes, status')
    .in('professional_id', professionalIds)
    .in('status', ['created', 'confirmed'])
    .gte('start_time', `${startDate}T00:00:00`)
    .lte('start_time', `${endDate}T23:59:59`)

  if (error) {
    console.error('Failed to fetch appointments:', error.message)
    return new Map()
  }

  // Group appointments by professional
  const appointmentsByProfessional = new Map<string, Array<{ start_time: string; duration_minutes: number }>>()
  for (const apt of data || []) {
    const existing = appointmentsByProfessional.get(apt.professional_id) || []
    existing.push({ start_time: apt.start_time, duration_minutes: apt.duration_minutes })
    appointmentsByProfessional.set(apt.professional_id, existing)
  }

  return appointmentsByProfessional
}

/**
 * Check if a time slot matches a single schedule preference.
 *
 * - 'am' → slot starts before 12:00
 * - 'pm' → slot starts between 12:00-17:00
 * - 'evening' → slot starts after 17:00
 * - 'weekend' → slot is on Saturday (6) or Sunday (0)
 * - 'other' → no filtering (all slots match)
 */
function matchesSinglePreference(
  slotStart: Date,
  preference: SchedulePreference
): boolean {
  if (preference === 'other') {
    return true
  }

  const hour = slotStart.getHours()
  const dayOfWeek = slotStart.getDay() // 0 = Sunday, 6 = Saturday

  switch (preference) {
    case 'am':
      return hour < 12
    case 'pm':
      return hour >= 12 && hour < 17
    case 'evening':
      return hour >= 17
    case 'weekend':
      return dayOfWeek === 0 || dayOfWeek === 6
    default:
      return true
  }
}

/**
 * Check if a time slot matches ANY of the schedule preferences.
 * If preferences array is empty or contains 'other', all slots match.
 */
function matchesSchedulePreferences(
  slotStart: Date,
  preferences: SchedulePreference[]
): boolean {
  // Empty array or contains 'other' = no filtering
  if (preferences.length === 0 || preferences.includes('other')) {
    return true
  }

  // Slot matches if it matches ANY of the preferences
  return preferences.some((pref) => matchesSinglePreference(slotStart, pref))
}

/**
 * Calculate available slots for a professional, filtering by schedule preferences.
 * Returns slots that are not booked and match ANY of the preferences.
 *
 * Uses 50-minute slot duration with 30-minute increments to match the
 * slot-selection-drawer calculation for consistent counts.
 */
function calculateAvailableSlots(
  blocks: DbAvailabilityBlock[],
  bookedAppointments: Array<{ start_time: string; duration_minutes: number }>,
  schedulePreferences: SchedulePreference[],
  now: Date
): AvailableSlotInfo[] {
  const slots: AvailableSlotInfo[] = []
  const slotDuration = 50 // Match default service duration (50 minutes)
  const slotIncrement = 30 // 30-minute increments for flexibility

  for (const block of blocks) {
    const blockStart = new Date(block.start_time)
    const blockEnd = new Date(block.end_time)

    // Skip blocks entirely in the past
    if (blockEnd <= now) continue

    // Adjust start time if block starts in the past
    const effectiveStart = blockStart < now ? now : blockStart

    // Start from the block's actual start time (no rounding to hour)
    let slotStart = new Date(effectiveStart)

    while (slotStart < blockEnd) {
      const slotEnd = new Date(slotStart.getTime() + slotDuration * 60 * 1000)

      // Make sure slot fits within block
      if (slotEnd > blockEnd) break

      // Check if slot matches ANY schedule preference
      if (!matchesSchedulePreferences(slotStart, schedulePreferences)) {
        slotStart = new Date(slotStart.getTime() + slotIncrement * 60 * 1000)
        continue
      }

      // Check if slot is booked
      const isBooked = bookedAppointments.some((apt) => {
        const aptStart = new Date(apt.start_time)
        const aptEnd = new Date(aptStart.getTime() + apt.duration_minutes * 60 * 1000)
        // Check for overlap
        return slotStart < aptEnd && slotEnd > aptStart
      })

      if (!isBooked) {
        const dateStr = slotStart.toISOString().split('T')[0]!
        slots.push({
          date: dateStr,
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          blockId: block.id,
        })
      }

      // Move to next potential slot (30-minute increments)
      slotStart = new Date(slotStart.getTime() + slotIncrement * 60 * 1000)
    }
  }

  return slots
}

// =============================================================================
// MAIN MATCHING FUNCTION
// =============================================================================

/**
 * Match professionals to a demande based on clientele, motifs, and availability.
 *
 * Process:
 * 1. Filter by clientele (HARD FILTER) - demandType or age category
 * 2. Score by motifs (percentage of matched motifs)
 * 3. Filter by availability (schedule preference + at least 1 slot)
 * 4. Rank by motif score (desc), then by slot count (desc)
 * 5. Return top 5 results
 *
 * @param input - Demande and client information
 * @param candidates - Pre-collected candidate data from data-collector
 * @returns Matching result with professionals and filter counts
 */
export async function matchProfessionals(
  input: SimpleMatcherInput,
  candidates: CandidateData[]
): Promise<SimpleMatcherResult> {
  const { demande, primaryClient } = input
  const totalEvaluated = candidates.length

  // Calculate age category for the primary client
  const ageCategory = getAgeCategory(primaryClient.birthday)

  // ==========================================================================
  // STEP 1: Clientele filtering (HARD FILTER)
  // ==========================================================================
  const clienteleFiltered = candidates.filter((candidate) =>
    canServeClientele(candidate, demande.demandType, ageCategory)
  )
  const filteredByClientele = totalEvaluated - clienteleFiltered.length

  // If no candidates pass clientele filter, return early
  if (clienteleFiltered.length === 0) {
    return {
      professionals: [],
      totalEvaluated,
      filteredByClientele,
      filteredByAvailability: 0,
    }
  }

  // ==========================================================================
  // STEP 2: Calculate motif scores
  // ==========================================================================
  const scoredCandidates = clienteleFiltered.map((candidate) => {
    const { score, matched, unmatched } = calculateMotifScore(
      demande.selectedMotifs,
      candidate.motifs
    )
    return {
      candidate,
      motifScore: score,
      matchedMotifs: matched,
      unmatchedMotifs: unmatched,
    }
  })

  // ==========================================================================
  // STEP 3: Fetch and filter availability
  // ==========================================================================
  const now = new Date()
  const startDate = now.toISOString().split('T')[0]!
  const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]!

  const professionalIds = scoredCandidates.map((sc) => sc.candidate.professional.id)

  // Fetch availability and appointments in parallel
  const [blocksMap, appointmentsMap] = await Promise.all([
    fetchAvailabilityBlocks(professionalIds, startDate, endDate),
    fetchBookedAppointments(professionalIds, startDate, endDate),
  ])

  // Calculate available slots for each candidate
  const candidatesWithSlots = scoredCandidates.map((sc) => {
    const blocks = blocksMap.get(sc.candidate.professional.id) || []
    const appointments = appointmentsMap.get(sc.candidate.professional.id) || []
    const availableSlots = calculateAvailableSlots(
      blocks,
      appointments,
      demande.schedulePreferences,
      now
    )

    return {
      ...sc,
      availableSlots,
      availableSlotsCount: availableSlots.length,
      nextAvailableSlot: availableSlots[0]?.startTime ?? null,
    }
  })

  // Filter out candidates with no available slots
  const availabilityFiltered = candidatesWithSlots.filter(
    (c) => c.availableSlotsCount > 0
  )
  const filteredByAvailability = candidatesWithSlots.length - availabilityFiltered.length

  // ==========================================================================
  // STEP 4: Rank by motif score (desc), then by slot count (desc)
  // ==========================================================================
  const ranked = [...availabilityFiltered].sort((a, b) => {
    // Primary: motif score (descending)
    if (b.motifScore !== a.motifScore) {
      return b.motifScore - a.motifScore
    }
    // Secondary: slot count (descending)
    return b.availableSlotsCount - a.availableSlotsCount
  })

  // ==========================================================================
  // STEP 5: Take top 5 and format result
  // ==========================================================================
  const top5 = ranked.slice(0, 5)

  const professionals: MatchedProfessional[] = top5.map((result) => ({
    professionalId: result.candidate.professional.id,
    displayName: result.candidate.professional.displayName,
    professionTitles: result.candidate.professions.map((p) => p.labelFr),
    motifScore: result.motifScore,
    matchedMotifs: result.matchedMotifs,
    unmatchedMotifs: result.unmatchedMotifs,
    availableSlots: result.availableSlots,
    availableSlotsCount: result.availableSlotsCount,
    nextAvailableSlot: result.nextAvailableSlot,
  }))

  return {
    professionals,
    totalEvaluated,
    filteredByClientele,
    filteredByAvailability,
  }
}
