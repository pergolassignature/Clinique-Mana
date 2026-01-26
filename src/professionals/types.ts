import { z } from 'zod'

// =============================================================================
// ENUMS
// =============================================================================

export const ProfessionalStatus = z.enum(['pending', 'invited', 'active', 'inactive'])
export type ProfessionalStatus = z.infer<typeof ProfessionalStatus>

export const SpecialtyCategory = z.enum(['therapy_type', 'clientele'])
export type SpecialtyCategory = z.infer<typeof SpecialtyCategory>


export const DocumentType = z.enum(['cv', 'diploma', 'license', 'insurance', 'photo', 'fiche', 'other'])
export type DocumentType = z.infer<typeof DocumentType>

export const InviteStatus = z.enum(['pending', 'opened', 'completed', 'expired', 'revoked'])
export type InviteStatus = z.infer<typeof InviteStatus>

export const InviteType = z.enum(['onboarding', 'update_request'])
export type InviteType = z.infer<typeof InviteType>

// Questionnaire sections (excludes 'review' which is always accessible)
export const QUESTIONNAIRE_SECTIONS = [
  'personal',
  'professional',
  'portrait',
  'specialties',
  'motifs',
  'photo',
  'insurance',
  'consent',
] as const
export type QuestionnaireSection = (typeof QUESTIONNAIRE_SECTIONS)[number]

export const QuestionnaireStatus = z.enum(['draft', 'submitted', 'reviewed', 'approved'])
export type QuestionnaireStatus = z.infer<typeof QuestionnaireStatus>

export const AuditAction = z.enum([
  'created',
  'updated',
  'deleted',
  'status_changed',
  'portrait_updated',
  'fiche_generated',
  'document_uploaded',
  'document_verified',
  'document_rejected',
  'document_expiry_updated',
  'document_deleted',
  'invite_created',
  'invite_sent',
  'invite_opened',
  'invite_completed',
  'invite_expired',
  'invite_revoked',
  'invite_deleted',
  'questionnaire_started',
  'questionnaire_submitted',
  'questionnaire_reviewed',
  'questionnaire_approved',
  'specialty_added',
  'specialty_removed',
])
export type AuditAction = z.infer<typeof AuditAction>

export const AuditEntityType = z.enum(['professional', 'document', 'invite', 'questionnaire', 'specialty'])
export type AuditEntityType = z.infer<typeof AuditEntityType>

// =============================================================================
// CORE SCHEMAS
// =============================================================================

export const SpecialtySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name_fr: z.string(),
  category: SpecialtyCategory,
  is_active: z.boolean(),
  sort_order: z.number(),
  created_at: z.string().datetime(),
})
export type Specialty = z.infer<typeof SpecialtySchema>

export const ProfessionalSpecialtySchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  specialty_id: z.string().uuid(),
  is_specialized: z.boolean(),
  created_at: z.string().datetime(),
  // Joined data
  specialty: SpecialtySchema.optional(),
})
export type ProfessionalSpecialty = z.infer<typeof ProfessionalSpecialtySchema>

// Motif schema (from motifs table)
export const MotifSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  is_active: z.boolean(),
  is_restricted: z.boolean(),
  category_id: z.string().uuid().nullable().optional(),
})
export type Motif = z.infer<typeof MotifSchema>

export const ProfessionalMotifSchema = z.object({
  professional_id: z.string().uuid(),
  motif_id: z.string().uuid(),
  is_specialized: z.boolean(),
  created_at: z.string().datetime(),
  // Joined data
  motif: MotifSchema.optional(),
})
export type ProfessionalMotif = z.infer<typeof ProfessionalMotifSchema>

// =============================================================================
// PROFESSION TITLES (from services v2 schema)
// =============================================================================

export const ProfessionTitleSchema = z.object({
  key: z.string(),
  label_fr: z.string(),
  profession_category_key: z.string(),
})
export type ProfessionTitle = z.infer<typeof ProfessionTitleSchema>

export const ProfessionalProfessionSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  profession_title_key: z.string(),
  license_number: z.string(),
  is_primary: z.boolean(),
  created_at: z.string().datetime(),
  // Joined data
  profession_title: ProfessionTitleSchema.optional(),
})
export type ProfessionalProfession = z.infer<typeof ProfessionalProfessionSchema>

export const ProfessionalDocumentSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  document_type: DocumentType,
  file_name: z.string(),
  file_path: z.string(),
  file_size: z.number().nullable(),
  mime_type: z.string().nullable(),
  verified_at: z.string().datetime().nullable(),
  verified_by: z.string().uuid().nullable(),
  expires_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type ProfessionalDocument = z.infer<typeof ProfessionalDocumentSchema>

export const OnboardingInviteSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  token: z.string(),
  email: z.string().email(),
  status: InviteStatus,
  invite_type: InviteType.optional().default('onboarding'),
  requested_sections: z.array(z.enum(QUESTIONNAIRE_SECTIONS)).nullable().optional(),
  parent_invite_id: z.string().uuid().nullable().optional(),
  pre_populated_data: z.unknown().nullable().optional(), // Typed as PrePopulatedData at runtime
  sent_at: z.string().datetime().nullable(),
  opened_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  expires_at: z.string().datetime(),
  sent_by: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
})
export type OnboardingInvite = z.infer<typeof OnboardingInviteSchema>

// =============================================================================
// QUESTIONNAIRE SCHEMAS
// Flexible JSONB structure for questionnaire responses
// =============================================================================

// Upload info stored in responses
export const UploadInfoSchema = z.object({
  document_id: z.string().uuid(),
  file_path: z.string(),
  file_name: z.string(),
  file_size: z.number().optional(),
  mime_type: z.string().optional(),
  uploaded_at: z.string().datetime(),
})
export type UploadInfo = z.infer<typeof UploadInfoSchema>

// Image rights consent stored in responses
export const ImageRightsConsentSchema = z.object({
  version: z.string(), // e.g., "v1"
  signed: z.boolean(),
  signer_full_name: z.string(),
  signer_email: z.string().email().optional(),
  signed_at: z.string().datetime(),
  renewal_policy: z.literal('12_months_auto_renew'),
  withdrawal_notice: z.literal('3_months'),
})
export type ImageRightsConsent = z.infer<typeof ImageRightsConsentSchema>

// Schema for profession entry in questionnaire (supports up to 2)
export const QuestionnaireProfessionSchema = z.object({
  profession_title_key: z.string(),
  license_number: z.string(),
  is_primary: z.boolean(),
})
export type QuestionnaireProfession = z.infer<typeof QuestionnaireProfessionSchema>

// Pre-populated data structure for update request invites
export const PrePopulatedDataSchema = z.object({
  // From professionals table
  portrait_bio: z.string().nullable().optional(),
  portrait_approach: z.string().nullable().optional(),
  public_email: z.string().nullable().optional(),
  public_phone: z.string().nullable().optional(),
  years_experience: z.number().nullable().optional(),
  // From professional_professions
  professions: z.array(QuestionnaireProfessionSchema).optional(),
  // From professional_specialties (codes only)
  specialties: z.array(z.string()).optional(),
  // From professional_motifs (keys only)
  motifs: z.array(z.string()).optional(),
  // From professional_documents (paths for preview)
  uploads: z
    .object({
      photo: UploadInfoSchema.optional(),
      insurance: UploadInfoSchema.optional(),
    })
    .optional(),
  // From existing submission (consent info)
  image_rights_consent: ImageRightsConsentSchema.optional(),
})
export type PrePopulatedData = z.infer<typeof PrePopulatedDataSchema>

export const QuestionnaireResponsesSchema = z.object({
  // Personal info (full_name is pre-populated from profile and read-only)
  full_name: z.string().optional(),

  // Professional info - supports up to 2 profession titles
  professions: z.array(QuestionnaireProfessionSchema).max(2).optional(),
  years_experience: z.number().optional(),

  // Legacy fields (kept for backwards compatibility during migration)
  /** @deprecated Use professions array instead */
  profession_title_key: z.string().optional(),
  /** @deprecated Use professions array instead */
  license_number: z.string().optional(),

  // Bio/Portrait
  bio: z.string().optional(),
  approach: z.string().optional(),
  education: z.string().optional(),

  // Contact
  public_email: z.string().email().optional(),
  public_phone: z.string().optional(),

  // Specialties (array of specialty codes)
  specialties: z.array(z.string()).optional(),

  // Motifs (array of motif keys)
  motifs: z.array(z.string()).optional(),

  // Languages
  languages: z.array(z.string()).optional(),

  // Availability
  availability_notes: z.string().optional(),

  // Document uploads (stored as upload info)
  uploads: z.object({
    photo: UploadInfoSchema.optional(),
    insurance: UploadInfoSchema.optional(),
  }).optional(),

  // Image rights consent
  image_rights_consent: ImageRightsConsentSchema.optional(),

  // Additional fields can be added as needed
}).passthrough() // Allow additional fields for flexibility

export type QuestionnaireResponses = z.infer<typeof QuestionnaireResponsesSchema>

export const QuestionnaireSubmissionSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  invite_id: z.string().uuid().nullable(),
  responses: QuestionnaireResponsesSchema,
  status: QuestionnaireStatus,
  reviewed_at: z.string().datetime().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  review_notes: z.string().nullable(),
  submitted_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type QuestionnaireSubmission = z.infer<typeof QuestionnaireSubmissionSchema>

// =============================================================================
// PROFESSIONAL SCHEMA
// =============================================================================

export const ProfessionalSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  status: ProfessionalStatus,
  deactivation_reason: z.enum(['manual', 'insurance_expired']).nullable(),
  portrait_bio: z.string().nullable(),
  portrait_approach: z.string().nullable(),
  public_email: z.string().email().nullable(),
  public_phone: z.string().nullable(),
  license_number: z.string().nullable(),
  years_experience: z.number().nullable(),
  fiche_generated_at: z.string().datetime().nullable(),
  fiche_version: z.number(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type Professional = z.infer<typeof ProfessionalSchema>

// Extended professional with joined data
export const ProfessionalWithRelationsSchema = ProfessionalSchema.extend({
  // From profiles table
  profile: z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid().nullable(),
    display_name: z.string(),
    email: z.string().email(),
    role: z.literal('provider'),
    status: z.enum(['active', 'disabled']),
  }).optional(),

  // Specialties
  specialties: z.array(ProfessionalSpecialtySchema).optional(),

  // Motifs
  motifs: z.array(ProfessionalMotifSchema).optional(),

  // Professions (1-2 with license numbers)
  professions: z.array(ProfessionalProfessionSchema).optional(),

  // Documents
  documents: z.array(ProfessionalDocumentSchema).optional(),

  // Latest invite
  latest_invite: OnboardingInviteSchema.nullable().optional(),

  // Latest submission
  latest_submission: QuestionnaireSubmissionSchema.nullable().optional(),
})
export type ProfessionalWithRelations = z.infer<typeof ProfessionalWithRelationsSchema>

// =============================================================================
// AUDIT LOG SCHEMA
// =============================================================================

export const ProfessionalAuditLogSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  action: AuditAction,
  entity_type: AuditEntityType,
  entity_id: z.string().uuid().nullable(),
  old_value: z.record(z.string(), z.unknown()).nullable(),
  new_value: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string().datetime(),
  // Joined data
  actor: z.object({
    display_name: z.string(),
  }).nullable().optional(),
})
export type ProfessionalAuditLog = z.infer<typeof ProfessionalAuditLogSchema>

// =============================================================================
// INPUT SCHEMAS (for forms/mutations)
// =============================================================================

export const CreateProfessionalInput = z.object({
  profile_id: z.string().uuid(),
  status: ProfessionalStatus.optional(),
  public_email: z.string().email().optional(),
  public_phone: z.string().optional(),
})
export type CreateProfessionalInput = z.infer<typeof CreateProfessionalInput>

export const UpdateProfessionalInput = z.object({
  portrait_bio: z.string().optional(),
  portrait_approach: z.string().optional(),
  public_email: z.string().email().nullable().optional(),
  public_phone: z.string().nullable().optional(),
  license_number: z.string().nullable().optional(),
  years_experience: z.number().nullable().optional(),
})
export type UpdateProfessionalInput = z.infer<typeof UpdateProfessionalInput>

export const UpdateProfessionalStatusInput = z.object({
  status: ProfessionalStatus,
})
export type UpdateProfessionalStatusInput = z.infer<typeof UpdateProfessionalStatusInput>

export const CreateInviteInput = z.object({
  professional_id: z.string().uuid(),
  email: z.string().email(),
})
export type CreateInviteInput = z.infer<typeof CreateInviteInput>

export const CreateUpdateRequestInput = z.object({
  professional_id: z.string().uuid(),
  email: z.string().email(),
  requested_sections: z.array(z.enum(QUESTIONNAIRE_SECTIONS)).min(1),
})
export type CreateUpdateRequestInput = z.infer<typeof CreateUpdateRequestInput>

export const UploadDocumentInput = z.object({
  professional_id: z.string().uuid(),
  document_type: DocumentType,
  file_name: z.string(),
  file_path: z.string(),
  file_size: z.number().optional(),
  mime_type: z.string().optional(),
  expires_at: z.string().datetime().optional(),
})
export type UploadDocumentInput = z.infer<typeof UploadDocumentInput>

export const VerifyDocumentInput = z.object({
  id: z.string().uuid(),
  verified: z.boolean(),
})
export type VerifyDocumentInput = z.infer<typeof VerifyDocumentInput>

export const UpdateDocumentExpiryInput = z.object({
  id: z.string().uuid(),
  expires_at: z.string().datetime().nullable(),
})
export type UpdateDocumentExpiryInput = z.infer<typeof UpdateDocumentExpiryInput>

export const AddSpecialtyInput = z.object({
  professional_id: z.string().uuid(),
  specialty_id: z.string().uuid(),
  is_specialized: z.boolean().optional(),
})
export type AddSpecialtyInput = z.infer<typeof AddSpecialtyInput>

export const SubmitQuestionnaireInput = z.object({
  professional_id: z.string().uuid(),
  invite_id: z.string().uuid().optional(),
  responses: QuestionnaireResponsesSchema,
})
export type SubmitQuestionnaireInput = z.infer<typeof SubmitQuestionnaireInput>

export const ReviewQuestionnaireInput = z.object({
  id: z.string().uuid(),
  status: z.enum(['reviewed', 'approved']),
  review_notes: z.string().optional(),
})
export type ReviewQuestionnaireInput = z.infer<typeof ReviewQuestionnaireInput>

// =============================================================================
// LIST/FILTER SCHEMAS
// =============================================================================

export const ProfessionalsListFilters = z.object({
  status: ProfessionalStatus.optional(),
  search: z.string().optional(),
  specialty_ids: z.array(z.string().uuid()).optional(),
})
export type ProfessionalsListFilters = z.infer<typeof ProfessionalsListFilters>

export const ProfessionalsListSort = z.object({
  field: z.enum(['display_name', 'created_at', 'status']),
  direction: z.enum(['asc', 'desc']),
})
export type ProfessionalsListSort = z.infer<typeof ProfessionalsListSort>

// =============================================================================
// UI STATE TYPES
// =============================================================================

export interface ProfessionalListItem {
  id: string
  profile_id: string
  display_name: string
  email: string
  status: ProfessionalStatus
  specialty_count: number
  document_count: number
  has_pending_invite: boolean
  created_at: string
}

export type ProfessionalDetailTab = 'apercu' | 'profil' | 'profil-public' | 'services' | 'documents' | 'historique'

export interface DocumentUploadProgress {
  file_name: string
  progress: number
  status: 'uploading' | 'success' | 'error'
  error?: string
}

// =============================================================================
// PROFESSIONAL SERVICES (Junction: professionals ↔ services)
// =============================================================================

export const ProfessionalServiceSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  profession_title_key: z.string(),
  service_id: z.string().uuid(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type ProfessionalService = z.infer<typeof ProfessionalServiceSchema>

export const ProfessionalServiceWithDetailsSchema = ProfessionalServiceSchema.extend({
  service: z.object({
    id: z.string().uuid(),
    key: z.string(),
    name_fr: z.string(),
    default_duration_minutes: z.number().nullable(),
  }),
})
export type ProfessionalServiceWithDetails = z.infer<typeof ProfessionalServiceWithDetailsSchema>
