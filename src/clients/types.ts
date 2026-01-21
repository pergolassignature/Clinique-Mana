import { z } from 'zod'

// =============================================================================
// ENUMS
// =============================================================================

export const ClientStatus = z.enum(['active', 'archived'])
export type ClientStatus = z.infer<typeof ClientStatus>

export const Sex = z.enum(['male', 'female', 'other'])
export type Sex = z.infer<typeof Sex>

export const Language = z.enum(['fr', 'en', 'other'])
export type Language = z.infer<typeof Language>

export const Province = z.enum(['QC', 'ON', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU'])
export type Province = z.infer<typeof Province>

export const ConsentStatus = z.enum(['valid', 'expired', 'missing'])
export type ConsentStatus = z.infer<typeof ConsentStatus>

// =============================================================================
// CLIENT SCHEMA (32 fields)
// =============================================================================

export const ClientSchema = z.object({
  // Primary key
  id: z.string().uuid(), // UUID from database
  // Identity (6 fields)
  clientId: z.string(), // 7-digit format: CLI-0000001
  firstName: z.string(),
  lastName: z.string(),
  sex: Sex.nullable(),
  language: Language,
  birthday: z.string().nullable(), // ISO date

  // Contact (8 fields)
  email: z.string().email().nullable(),
  cellPhoneCountryCode: z.string(),
  cellPhone: z.string().nullable(),
  homePhoneCountryCode: z.string(),
  homePhone: z.string().nullable(),
  workPhoneCountryCode: z.string(),
  workPhone: z.string().nullable(),
  workPhoneExtension: z.string().nullable(),

  // Address (7 fields)
  streetNumber: z.string().nullable(),
  streetName: z.string().nullable(),
  apartment: z.string().nullable(),
  city: z.string().nullable(),
  province: Province.nullable(),
  country: z.string(),
  postalCode: z.string().nullable(),

  // Clinical/Admin (9 fields)
  lastAppointmentDateTime: z.string().datetime().nullable(),
  lastAppointmentService: z.string().nullable(),
  lastAppointmentProfessional: z.string().nullable(),
  primaryProfessionalId: z.string().uuid().nullable(),
  referredBy: z.string().nullable(),
  customField: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  isArchived: z.boolean(),
  responsibleClientId: z.string().nullable(), // For minors - links to parent/guardian
})
export type Client = z.infer<typeof ClientSchema>

// =============================================================================
// LIST ITEM (for table view)
// =============================================================================

export interface ClientListItem {
  id: string
  clientId: string
  firstName: string
  lastName: string
  birthday: string | null
  email: string | null
  cellPhone: string | null
  lastAppointmentDateTime: string | null
  status: ClientStatus
  tags: string[]
  primaryProfessionalId: string | null
  primaryProfessionalName: string | null
}

// =============================================================================
// FILTER & SORT TYPES
// =============================================================================

export const ClientsListFilters = z.object({
  status: ClientStatus.optional(),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  primaryProfessionalId: z.string().uuid().optional(),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }).optional(),
})
export type ClientsListFilters = z.infer<typeof ClientsListFilters>

export const ClientsListSort = z.object({
  field: z.enum(['name', 'clientId', 'birthday', 'lastAppointment', 'createdAt']),
  direction: z.enum(['asc', 'desc']),
})
export type ClientsListSort = z.infer<typeof ClientsListSort>

// =============================================================================
// DRAWER SECTION TYPES
// =============================================================================

export interface ClientVisit {
  id: string
  date: string
  serviceName: string
  professionalName: string
  status: 'completed' | 'cancelled' | 'no-show'
  amount: number
}

export interface ClientNote {
  id: string
  content: string
  createdAt: string
  authorName: string
}

export interface ClientConsent {
  id: string
  type: string
  status: ConsentStatus
  signedAt: string | null
  expiresAt: string | null
  signedBy: string | null
}

// =============================================================================
// CLIENT RELATION
// =============================================================================

export const RelationType = z.enum(['parent', 'child', 'spouse', 'sibling', 'guardian', 'other'])
export type RelationType = z.infer<typeof RelationType>

export interface ClientRelation {
  id: string
  relatedClientId: string
  relatedClientName: string // For display
  relationType: RelationType
  notes?: string // Optional notes about the relationship
}

// =============================================================================
// CLIENT WITH RELATIONS (for drawer)
// =============================================================================

export interface ClientWithRelations extends Client {
  visits?: ClientVisit[]
  notes?: ClientNote[]
  consents?: ClientConsent[]
  relations?: ClientRelation[]
  balance?: number
  responsibleClient?: {
    clientId: string
    firstName: string
    lastName: string
  } | null
  primaryProfessional?: {
    id: string
    displayName: string
  } | null
}

// =============================================================================
// INPUT SCHEMAS (for future mutations)
// =============================================================================

export const CreateClientInput = z.object({
  // Identity (required)
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Identity (optional)
  sex: Sex.nullable().optional(),
  language: Language.optional(),
  birthday: z.string().nullable().optional(),
  // Contact
  email: z.string().email().nullable().optional(),
  cellPhoneCountryCode: z.string().optional(),
  cellPhone: z.string().nullable().optional(),
  homePhoneCountryCode: z.string().optional(),
  homePhone: z.string().nullable().optional(),
  workPhoneCountryCode: z.string().optional(),
  workPhone: z.string().nullable().optional(),
  workPhoneExtension: z.string().nullable().optional(),
  // Address
  streetNumber: z.string().nullable().optional(),
  streetName: z.string().nullable().optional(),
  apartment: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: Province.nullable().optional(),
  country: z.string().optional(),
  postalCode: z.string().nullable().optional(),
  // Admin
  referredBy: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  primaryProfessionalId: z.string().uuid().nullable().optional(),
})
export type CreateClientInput = z.infer<typeof CreateClientInput>

export const UpdateClientInput = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  sex: Sex.nullable().optional(),
  language: Language.optional(),
  birthday: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  cellPhoneCountryCode: z.string().optional(),
  cellPhone: z.string().nullable().optional(),
  homePhoneCountryCode: z.string().optional(),
  homePhone: z.string().nullable().optional(),
  workPhoneCountryCode: z.string().optional(),
  workPhone: z.string().nullable().optional(),
  workPhoneExtension: z.string().nullable().optional(),
  streetNumber: z.string().nullable().optional(),
  streetName: z.string().nullable().optional(),
  apartment: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: Province.nullable().optional(),
  country: z.string().optional(),
  postalCode: z.string().nullable().optional(),
  referredBy: z.string().nullable().optional(),
  customField: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  primaryProfessionalId: z.string().uuid().nullable().optional(),
  responsibleClientId: z.string().nullable().optional(),
})
export type UpdateClientInput = z.infer<typeof UpdateClientInput>
