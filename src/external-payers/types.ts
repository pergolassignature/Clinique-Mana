import { z } from 'zod'

// =============================================================================
// CONSTANTS
// =============================================================================

/** IVAC fixed rate per appointment in cents ($94.50) */
export const IVAC_RATE_CENTS = 9450

/** IVAC fixed rate formatted for display */
export const IVAC_RATE_DISPLAY = '94,50 $'

// =============================================================================
// ENUMS
// =============================================================================

export const ExternalPayerType = z.enum(['ivac', 'pae'])
export type ExternalPayerType = z.infer<typeof ExternalPayerType>

export const PAECoverageRuleType = z.enum([
  'free_appointments',
  'shared_cost',
  'fixed_client_amount',
  'included_services',
])
export type PAECoverageRuleType = z.infer<typeof PAECoverageRuleType>

// =============================================================================
// CLINIC SETTINGS
// =============================================================================

export const ClinicSettingsSchema = z.object({
  id: z.string().uuid(),
  ivac_provider_number: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type ClinicSettings = z.infer<typeof ClinicSettingsSchema>

// =============================================================================
// PROFESSIONAL IVAC NUMBER
// =============================================================================

export const ProfessionalIvacNumberSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  ivac_number: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type ProfessionalIvacNumber = z.infer<typeof ProfessionalIvacNumberSchema>

// =============================================================================
// PAE COVERAGE RULES
// =============================================================================

const BaseCoverageRuleSchema = z.object({
  order: z.number().int().min(1),
})

export const FreeAppointmentsRuleSchema = BaseCoverageRuleSchema.extend({
  type: z.literal('free_appointments'),
  appointment_count: z.number().int().min(1),
})
export type FreeAppointmentsRule = z.infer<typeof FreeAppointmentsRuleSchema>

export const SharedCostRuleSchema = BaseCoverageRuleSchema.extend({
  type: z.literal('shared_cost'),
  from_appointment: z.number().int().min(1),
  pae_percentage: z.number().int().min(0).max(100),
})
export type SharedCostRule = z.infer<typeof SharedCostRuleSchema>

export const FixedClientAmountRuleSchema = BaseCoverageRuleSchema.extend({
  type: z.literal('fixed_client_amount'),
  from_appointment: z.number().int().min(1),
  client_amount_cents: z.number().int().min(0),
})
export type FixedClientAmountRule = z.infer<typeof FixedClientAmountRuleSchema>

export const IncludedServicesRuleSchema = BaseCoverageRuleSchema.extend({
  type: z.literal('included_services'),
  services: z.array(z.string()).min(1),
})
export type IncludedServicesRule = z.infer<typeof IncludedServicesRuleSchema>

export const PAECoverageRuleSchema = z.discriminatedUnion('type', [
  FreeAppointmentsRuleSchema,
  SharedCostRuleSchema,
  FixedClientAmountRuleSchema,
  IncludedServicesRuleSchema,
])
export type PAECoverageRule = z.infer<typeof PAECoverageRuleSchema>

// =============================================================================
// CLIENT EXTERNAL PAYER (base)
// =============================================================================

export const ClientExternalPayerBaseSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  payer_type: ExternalPayerType,
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type ClientExternalPayerBase = z.infer<typeof ClientExternalPayerBaseSchema>

// =============================================================================
// IVAC DETAILS
// =============================================================================

export const ClientPayerIvacSchema = z.object({
  payer_id: z.string().uuid(),
  file_number: z.string(),
  event_date: z.string().nullable(), // ISO date
  expiry_date: z.string().nullable(), // ISO date
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type ClientPayerIvac = z.infer<typeof ClientPayerIvacSchema>

// =============================================================================
// PAE DETAILS
// =============================================================================

export const ClientPayerPaeSchema = z.object({
  payer_id: z.string().uuid(),
  file_number: z.string(),
  employer_name: z.string().nullable(),
  pae_provider_name: z.string(),
  file_opening_fee: z.boolean(),
  reimbursement_percentage: z.number().int().min(0).max(100),
  maximum_amount_cents: z.number().int().min(0),
  expiry_date: z.string(), // ISO date, required
  coverage_rules: z.array(PAECoverageRuleSchema),
  appointments_used: z.number().int().min(0),
  amount_used_cents: z.number().int().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type ClientPayerPae = z.infer<typeof ClientPayerPaeSchema>

// =============================================================================
// COMBINED TYPES (for UI)
// =============================================================================

export interface ClientExternalPayerIvac extends ClientExternalPayerBase {
  payer_type: 'ivac'
  ivac_details: ClientPayerIvac
}

export interface ClientExternalPayerPae extends ClientExternalPayerBase {
  payer_type: 'pae'
  pae_details: ClientPayerPae
}

export type ClientExternalPayer = ClientExternalPayerIvac | ClientExternalPayerPae

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

export const CreateIvacPayerInputSchema = z.object({
  client_id: z.string().uuid(),
  file_number: z.string().min(1, 'Le numéro de dossier est requis'),
  event_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
})
export type CreateIvacPayerInput = z.infer<typeof CreateIvacPayerInputSchema>

export const UpdateIvacPayerInputSchema = z.object({
  file_number: z.string().min(1, 'Le numéro de dossier est requis').optional(),
  event_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
})
export type UpdateIvacPayerInput = z.infer<typeof UpdateIvacPayerInputSchema>

export const CreatePaePayerInputSchema = z.object({
  client_id: z.string().uuid(),
  file_number: z.string().min(1, 'Le numéro de dossier est requis'),
  employer_name: z.string().nullable().optional(),
  pae_provider_name: z.string().min(1, 'Le fournisseur PAE est requis'),
  file_opening_fee: z.boolean().default(false),
  reimbursement_percentage: z.number().int().min(0).max(100),
  maximum_amount_cents: z.number().int().min(0),
  expiry_date: z.string().min(1, 'La date d\'expiration est requise'),
  coverage_rules: z.array(PAECoverageRuleSchema).default([]),
})
export type CreatePaePayerInput = z.infer<typeof CreatePaePayerInputSchema>

export const UpdatePaePayerInputSchema = z.object({
  file_number: z.string().min(1).optional(),
  employer_name: z.string().nullable().optional(),
  pae_provider_name: z.string().min(1).optional(),
  file_opening_fee: z.boolean().optional(),
  reimbursement_percentage: z.number().int().min(0).max(100).optional(),
  maximum_amount_cents: z.number().int().min(0).optional(),
  expiry_date: z.string().optional(),
  coverage_rules: z.array(PAECoverageRuleSchema).optional(),
  appointments_used: z.number().int().min(0).optional(),
  amount_used_cents: z.number().int().min(0).optional(),
})
export type UpdatePaePayerInput = z.infer<typeof UpdatePaePayerInputSchema>

// =============================================================================
// UPDATE CLINIC SETTINGS INPUT
// =============================================================================

export const UpdateClinicSettingsInputSchema = z.object({
  ivac_provider_number: z.string().nullable().optional(),
})
export type UpdateClinicSettingsInput = z.infer<typeof UpdateClinicSettingsInputSchema>

// =============================================================================
// UPSERT PROFESSIONAL IVAC NUMBER INPUT
// =============================================================================

export const UpsertProfessionalIvacNumberInputSchema = z.object({
  professional_id: z.string().uuid(),
  ivac_number: z.string().min(1, 'Le numéro IVAC est requis'),
})
export type UpsertProfessionalIvacNumberInput = z.infer<typeof UpsertProfessionalIvacNumberInputSchema>
