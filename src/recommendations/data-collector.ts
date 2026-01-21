// src/recommendations/data-collector.ts
// Functions to gather all data needed for professional recommendations

import { supabase } from '@/lib/supabaseClient'
import type {
  RecommendationDataBundle,
  RecommendationConfig,
  CandidateData,
  DemandeData,
} from './types'

// =============================================================================
// POPULATION CATEGORY HELPERS
// =============================================================================

export type PopulationCategory = 'children' | 'adolescents' | 'adults' | 'seniors'

/**
 * Calculate age from a birthday string.
 * @param birthday - ISO date string (YYYY-MM-DD) or null
 * @returns Age in years or null if birthday is invalid
 */
export function calculateAge(birthday: string | null): number | null {
  if (!birthday) return null

  const birthDate = new Date(birthday)
  if (isNaN(birthDate.getTime())) return null

  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()

  // Adjust age if birthday hasn't occurred yet this year
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }

  return age
}

/**
 * Derive population category from age.
 * Categories:
 * - 0-12 years: 'children'
 * - 13-17 years: 'adolescents'
 * - 18-64 years: 'adults'
 * - 65+ years: 'seniors'
 *
 * @param birthday - ISO date string (YYYY-MM-DD) or null
 * @returns Population category or null if birthday is invalid
 */
export function calculatePopulationCategory(birthday: string | null): PopulationCategory | null {
  const age = calculateAge(birthday)
  if (age === null) return null

  if (age <= 12) return 'children'
  if (age <= 17) return 'adolescents'
  if (age <= 64) return 'adults'
  return 'seniors'
}

// =============================================================================
// DEMANDE DATA COLLECTION
// =============================================================================

interface DbDemandeRow {
  id: string
  demande_id: string
  demand_type: string | null
  urgency: string | null
  selected_motifs: string[] | null
  motif_description: string | null
  other_motif_text: string | null
  notes: string | null
  besoin_raison: string | null
  has_legal_context: 'yes' | 'no' | null
  demande_participants: Array<{
    id: string
    client_id: string
    clients: {
      id: string
      birthday: string | null
    } | null
  }> | null
}

/**
 * Fetch demande data with participant birthdays for population category calculation.
 */
async function fetchDemandeData(demandeId: string): Promise<DemandeData> {
  const { data, error } = await supabase
    .from('demandes')
    .select(`
      id,
      demande_id,
      demand_type,
      urgency,
      selected_motifs,
      motif_description,
      other_motif_text,
      notes,
      besoin_raison,
      has_legal_context,
      demande_participants (
        id,
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
    throw new Error(`Failed to fetch demande ${demandeId}: ${error.message}`)
  }

  // Cast through unknown to handle Supabase's dynamic return types
  const dbRow = data as unknown as DbDemandeRow

  // Extract population categories from participant birthdays
  const populationCategories: string[] = []
  const participants = dbRow.demande_participants || []

  for (const participant of participants) {
    if (participant.clients?.birthday) {
      const category = calculatePopulationCategory(participant.clients.birthday)
      if (category && !populationCategories.includes(category)) {
        populationCategories.push(category)
      }
    }
  }

  return {
    id: dbRow.demande_id,
    demandType: dbRow.demand_type,
    urgencyLevel: dbRow.urgency,
    motifKeys: dbRow.selected_motifs || [],
    motifDescription: dbRow.motif_description || '',
    otherMotifText: dbRow.other_motif_text || '',
    notes: dbRow.notes || '',
    populationCategories,
    hasLegalContext: dbRow.has_legal_context === 'yes',
  }
}

// =============================================================================
// PROFESSIONAL DATA COLLECTION
// =============================================================================

interface DbProfessionalRow {
  id: string
  profile_id: string
  status: string
  years_experience: number | null
  profile: {
    display_name: string
  } | null
  professions: Array<{
    profession_title_key: string
    is_primary: boolean
    profession_title: {
      key: string
      label_fr: string
      profession_category_key: string
    } | null
  }> | null
  specialties: Array<{
    proficiency_level: string | null
    specialty: {
      code: string
      category: string
    } | null
  }> | null
  motifs: Array<{
    motif: {
      key: string
    } | null
  }> | null
  services: Array<{
    service_id: string
    is_active: boolean
  }> | null
}

/**
 * Fetch all active professionals with their relations.
 * Only includes professionals with status='active'.
 */
async function fetchActiveProfessionals(): Promise<DbProfessionalRow[]> {
  const { data, error } = await supabase
    .from('professionals')
    .select(`
      id,
      profile_id,
      status,
      years_experience,
      profile:profiles!inner(display_name),
      professions:professional_professions(
        profession_title_key,
        is_primary,
        profession_title:profession_titles(key, label_fr, profession_category_key)
      ),
      specialties:professional_specialties(
        proficiency_level,
        specialty:specialties(code, category)
      ),
      motifs:professional_motifs(
        motif:motifs(key)
      ),
      services:professional_services(
        service_id,
        is_active
      )
    `)
    .eq('status', 'active')

  if (error) {
    throw new Error(`Failed to fetch professionals: ${error.message}`)
  }

  // Cast through unknown to handle Supabase's dynamic return types
  return (data || []) as unknown as DbProfessionalRow[]
}

// =============================================================================
// AVAILABILITY DATA COLLECTION
// =============================================================================

interface AvailabilitySlotInfo {
  slotsInWindow: number
  nextSlotDatetime: string | null
  hoursAvailableInWindow: number
}

/**
 * Calculate availability for a professional over the next N days.
 * Queries availability_blocks and appointments to find open slots.
 *
 * @param professionalId - Professional UUID
 * @param windowDays - Number of days to look ahead (default: 14)
 * @returns Availability info with slot count and next available datetime
 */
async function fetchProfessionalAvailability(
  professionalId: string,
  windowDays: number = 14
): Promise<AvailabilitySlotInfo> {
  const now = new Date()
  const startDate = now.toISOString().split('T')[0]
  const endDate = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  // Fetch availability blocks for this professional
  const { data: blocks, error: blocksError } = await supabase
    .from('availability_blocks')
    .select('id, start_time, end_time, type')
    .eq('professional_id', professionalId)
    .eq('type', 'available')
    .gte('start_time', `${startDate}T00:00:00`)
    .lte('end_time', `${endDate}T23:59:59`)
    .order('start_time', { ascending: true })

  if (blocksError) {
    console.error(`Failed to fetch availability for ${professionalId}:`, blocksError.message)
    return { slotsInWindow: 0, nextSlotDatetime: null, hoursAvailableInWindow: 0 }
  }

  // Fetch appointments that would occupy slots
  const { data: appointments, error: appointmentsError } = await supabase
    .from('appointments')
    .select('id, start_time, duration_minutes, status')
    .eq('professional_id', professionalId)
    .in('status', ['draft', 'confirmed'])
    .gte('start_time', `${startDate}T00:00:00`)
    .lte('start_time', `${endDate}T23:59:59`)

  if (appointmentsError) {
    console.error(`Failed to fetch appointments for ${professionalId}:`, appointmentsError.message)
  }

  const bookedAppointments = appointments || []

  // Calculate available hours and slots
  let totalAvailableMinutes = 0
  let slotsCount = 0
  let nextSlot: string | null = null
  const slotDuration = 60 // Assume 60-minute slots for counting

  for (const block of blocks || []) {
    const blockStart = new Date(block.start_time)
    const blockEnd = new Date(block.end_time)

    // Skip blocks that are entirely in the past
    if (blockEnd <= now) continue

    // Adjust start time if block starts in the past
    const effectiveStart = blockStart < now ? now : blockStart
    const blockMinutes = (blockEnd.getTime() - effectiveStart.getTime()) / (1000 * 60)

    // Subtract booked appointment time from this block
    let bookedMinutes = 0
    for (const apt of bookedAppointments) {
      const aptStart = new Date(apt.start_time)
      const aptEnd = new Date(aptStart.getTime() + apt.duration_minutes * 60 * 1000)

      // Check if appointment overlaps with this block
      if (aptStart < blockEnd && aptEnd > effectiveStart) {
        const overlapStart = Math.max(effectiveStart.getTime(), aptStart.getTime())
        const overlapEnd = Math.min(blockEnd.getTime(), aptEnd.getTime())
        bookedMinutes += (overlapEnd - overlapStart) / (1000 * 60)
      }
    }

    const availableMinutes = Math.max(0, blockMinutes - bookedMinutes)
    totalAvailableMinutes += availableMinutes

    // Count slots (rough estimate)
    slotsCount += Math.floor(availableMinutes / slotDuration)

    // Track next available slot
    if (nextSlot === null && availableMinutes > 0) {
      // Find first unbooked time in this block
      let slotStart = effectiveStart
      for (const apt of bookedAppointments.sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      )) {
        const aptStart = new Date(apt.start_time)
        const aptEnd = new Date(aptStart.getTime() + apt.duration_minutes * 60 * 1000)

        if (aptStart <= slotStart && aptEnd > slotStart) {
          // Slot is blocked, move to end of appointment
          slotStart = aptEnd
        }
      }

      if (slotStart < blockEnd) {
        nextSlot = slotStart.toISOString()
      }
    }
  }

  return {
    slotsInWindow: slotsCount,
    nextSlotDatetime: nextSlot,
    hoursAvailableInWindow: Math.round(totalAvailableMinutes / 60 * 10) / 10,
  }
}

/**
 * Batch fetch availability for multiple professionals.
 * More efficient than individual queries.
 */
async function batchFetchAvailability(
  professionalIds: string[],
  windowDays: number = 14
): Promise<Map<string, AvailabilitySlotInfo>> {
  const results = new Map<string, AvailabilitySlotInfo>()

  // Fetch in parallel with Promise.all
  const availabilityPromises = professionalIds.map(async (id) => {
    const availability = await fetchProfessionalAvailability(id, windowDays)
    return { id, availability }
  })

  const availabilityResults = await Promise.all(availabilityPromises)

  for (const { id, availability } of availabilityResults) {
    results.set(id, availability)
  }

  return results
}

// =============================================================================
// CONFIGURATION LOADING
// =============================================================================

/**
 * Fetch recommendation configuration by key.
 * Falls back to default config if key not found.
 */
async function fetchRecommendationConfig(
  configKey: string = 'default'
): Promise<RecommendationConfig> {
  const { data, error } = await supabase
    .from('demande_recommendation_configs')
    .select('*')
    .eq('key', configKey)
    .eq('is_active', true)
    .single()

  if (error) {
    // If config not found, return a default configuration
    if (error.code === 'PGRST116') {
      return getDefaultConfig()
    }
    throw new Error(`Failed to fetch config ${configKey}: ${error.message}`)
  }

  return mapDbConfigToConfig(data)
}

interface DbConfigRow {
  id: string
  key: string
  name_fr: string
  description_fr: string | null
  system_prompt: string
  user_prompt_template: string
  weight_motif_match: number
  weight_specialty_match: number
  weight_availability: number
  weight_profession_fit: number
  weight_experience: number
  require_availability_within_days: number
  require_motif_overlap: boolean
  require_population_match: boolean
  availability_max_hours: number
  experience_max_years: number
  is_active: boolean
}

function mapDbConfigToConfig(row: DbConfigRow): RecommendationConfig {
  return {
    id: row.id,
    key: row.key,
    nameFr: row.name_fr,
    descriptionFr: row.description_fr,
    systemPrompt: row.system_prompt,
    userPromptTemplate: row.user_prompt_template,
    weightMotifMatch: row.weight_motif_match,
    weightSpecialtyMatch: row.weight_specialty_match,
    weightAvailability: row.weight_availability,
    weightProfessionFit: row.weight_profession_fit,
    weightExperience: row.weight_experience,
    requireAvailabilityWithinDays: row.require_availability_within_days,
    requireMotifOverlap: row.require_motif_overlap,
    requirePopulationMatch: row.require_population_match,
    availabilityMaxHours: row.availability_max_hours,
    experienceMaxYears: row.experience_max_years,
    isActive: row.is_active,
  }
}

/**
 * Get default configuration when no config is stored.
 */
function getDefaultConfig(): RecommendationConfig {
  return {
    id: 'default',
    key: 'default',
    nameFr: 'Configuration par défaut',
    descriptionFr: null,
    systemPrompt: '',
    userPromptTemplate: '',
    weightMotifMatch: 0.3,
    weightSpecialtyMatch: 0.2,
    weightAvailability: 0.2,
    weightProfessionFit: 0.15,
    weightExperience: 0.15,
    requireAvailabilityWithinDays: 14,
    requireMotifOverlap: true,
    requirePopulationMatch: false,
    availabilityMaxHours: 40,
    experienceMaxYears: 20,
    isActive: true,
  }
}

// =============================================================================
// MAIN DATA COLLECTION
// =============================================================================

/**
 * Transform a professional database row into CandidateData format.
 */
function mapProfessionalToCandidate(
  row: DbProfessionalRow,
  availability: AvailabilitySlotInfo
): CandidateData {
  // Extract professions
  const professions = (row.professions || [])
    .filter((p) => p.profession_title)
    .map((p) => ({
      titleKey: p.profession_title_key,
      labelFr: p.profession_title!.label_fr,
      categoryKey: p.profession_title!.profession_category_key,
      isPrimary: p.is_primary,
    }))

  // Extract motif keys
  const motifs = (row.motifs || [])
    .filter((m) => m.motif)
    .map((m) => m.motif!.key)

  // Extract specialties
  const specialties = (row.specialties || [])
    .filter((s) => s.specialty)
    .map((s) => ({
      code: s.specialty!.code,
      category: s.specialty!.category,
      proficiencyLevel: s.proficiency_level,
    }))

  return {
    professional: {
      id: row.id,
      profileId: row.profile_id,
      displayName: row.profile?.display_name || 'Professionnel inconnu',
      status: row.status,
      yearsExperience: row.years_experience,
    },
    professions,
    motifs,
    specialties,
    availability,
  }
}

/**
 * Collects all data needed for generating recommendations.
 * This is the main entry point for the data collector module.
 *
 * @param demandeId - The demande display ID (e.g., 'DEM-2026-0042')
 * @param configKey - Optional config key (defaults to 'default')
 * @returns Complete data bundle for recommendation generation
 */
export async function collectRecommendationData(
  demandeId: string,
  configKey: string = 'default'
): Promise<RecommendationDataBundle> {
  // Collect all data in parallel where possible
  const [demande, professionals, config] = await Promise.all([
    fetchDemandeData(demandeId),
    fetchActiveProfessionals(),
    fetchRecommendationConfig(configKey),
  ])

  // Batch fetch availability for all professionals
  const professionalIds = professionals.map((p) => p.id)
  const availabilityMap = await batchFetchAvailability(
    professionalIds,
    config.requireAvailabilityWithinDays
  )

  // Transform professionals into candidates
  const candidates: CandidateData[] = professionals.map((professional) => {
    const availability = availabilityMap.get(professional.id) || {
      slotsInWindow: 0,
      nextSlotDatetime: null,
      hoursAvailableInWindow: 0,
    }
    return mapProfessionalToCandidate(professional, availability)
  })

  return {
    demande,
    candidates,
    config,
    collectedAt: new Date().toISOString(),
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  fetchDemandeData,
  fetchActiveProfessionals,
  fetchProfessionalAvailability,
  batchFetchAvailability,
  fetchRecommendationConfig,
  getDefaultConfig,
}
