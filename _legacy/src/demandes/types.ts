import { z } from 'zod'

// =============================================================================
// ENUMS
// =============================================================================

export const DemandeStatus = z.enum(['toAnalyze', 'assigned', 'closed'])
export type DemandeStatus = z.infer<typeof DemandeStatus>

export const DemandType = z.enum(['individual', 'couple', 'family', 'group'])
export type DemandType = z.infer<typeof DemandType>

export const UrgencyLevel = z.enum(['low', 'moderate', 'high'])
export type UrgencyLevel = z.infer<typeof UrgencyLevel>

export const ConsentStatus = z.enum(['valid', 'expired', 'missing'])
export type ConsentStatus = z.infer<typeof ConsentStatus>

export const ParticipantRole = z.enum(['principal', 'participant'])
export type ParticipantRole = z.infer<typeof ParticipantRole>

export const SchedulePreference = z.enum(['am', 'pm', 'evening', 'weekend', 'other'])
export type SchedulePreference = z.infer<typeof SchedulePreference>

// =============================================================================
// PARTICIPANT SCHEMAS
// =============================================================================

export const ParticipantConsentSchema = z.object({
  status: ConsentStatus,
  version: z.string().optional(),
  signedDate: z.string().optional(),
})
export type ParticipantConsent = z.infer<typeof ParticipantConsentSchema>

export const DemandeParticipantSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  role: ParticipantRole,
  consent: ParticipantConsentSchema,
})
export type DemandeParticipant = z.infer<typeof DemandeParticipantSchema>

// =============================================================================
// DEMANDE SCHEMA
// =============================================================================

export const DemandeSchema = z.object({
  id: z.string(), // e.g., DEM-2026-0042
  status: DemandeStatus,
  demandType: DemandType.nullable(),
  selectedMotifs: z.array(z.string()), // MotifKey[]
  motifDescription: z.string(),
  otherMotifText: z.string(),
  urgency: UrgencyLevel.nullable(),
  notes: z.string(),
  createdAt: z.string(),
  participants: z.array(DemandeParticipantSchema),
  schedulePreference: SchedulePreference.nullable(),
  schedulePreferenceDetail: z.string().nullable(),
})
export type Demande = z.infer<typeof DemandeSchema>

// =============================================================================
// LIST ITEM (for table view - optimized subset)
// =============================================================================

export interface DemandeListItem {
  id: string
  status: DemandeStatus
  demandType: DemandType | null
  urgency: UrgencyLevel | null
  createdAt: string
  // Derived fields for display
  primaryClientName: string | null
  participantCount: number
  motifLabels: string[] // First 2 motif labels for preview
  motifCount: number // Total motif count
  schedulePreferences: string[] // Multi-select schedule preferences
}

// =============================================================================
// FILTER & SORT TYPES
// =============================================================================

export const DemandesListFilters = z.object({
  status: DemandeStatus.optional(),
  search: z.string().optional(), // Searches client names, ID
})
export type DemandesListFilters = z.infer<typeof DemandesListFilters>

export const DemandesListSort = z.object({
  field: z.enum(['id', 'createdAt', 'status', 'urgency']),
  direction: z.enum(['asc', 'desc']),
})
export type DemandesListSort = z.infer<typeof DemandesListSort>
