// src/document-templates/types.ts
import { z } from 'zod'

// =============================================================================
// TEMPLATE STATUS
// =============================================================================

export const TemplateStatus = z.enum(['draft', 'published', 'archived'])
export type TemplateStatus = z.infer<typeof TemplateStatus>

// =============================================================================
// DOCUMENT INSTANCE STATUS
// =============================================================================

export const DocumentInstanceStatus = z.enum([
  'generated',        // PDF generated locally
  'sent_to_docuseal', // Uploaded to DocuSeal for signing
  'signed',           // All parties have signed
  'cancelled',        // Cancelled / voided
])
export type DocumentInstanceStatus = z.infer<typeof DocumentInstanceStatus>

// =============================================================================
// DATABASE SCHEMAS
// =============================================================================

export const DocumentTemplateSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  version: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  format: z.string(),
  content: z.string(),
  status: TemplateStatus,
  created_by: z.string().uuid().nullable(),
  updated_by: z.string().uuid().nullable(),
  published_at: z.string().datetime().nullable(),
  archived_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>

export const DocumentInstanceSchema = z.object({
  id: z.string().uuid(),
  template_id: z.string().uuid(),
  template_key: z.string(),
  template_version: z.number().int(),
  subject_type: z.string(),
  subject_id: z.string().uuid(),
  render_data: z.record(z.string(), z.unknown()),
  status: DocumentInstanceStatus,
  pdf_storage_path: z.string().nullable(),
  pdf_sha256: z.string().nullable(),
  docuseal_submission_id: z.string().nullable(),
  docuseal_audit_log: z.record(z.string(), z.unknown()).nullable(),
  audit_log_storage_path: z.string().nullable(),
  signed_pdf_storage_path: z.string().nullable(),
  signed_at: z.string().datetime().nullable(),
  clinic_signer_name: z.string().nullable(),
  clinic_signed_at: z.string().datetime().nullable(),
  generated_by: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type DocumentInstance = z.infer<typeof DocumentInstanceSchema>

// =============================================================================
// INPUT TYPES
// =============================================================================

export interface CreateTemplateInput {
  key: string
  title: string
  description?: string
  content: string
}

export interface UpdateTemplateDraftInput {
  title?: string
  description?: string
  content?: string
}

export interface GenerateDocumentInput {
  templateKey: string
  subjectType: 'professional' | 'client'
  subjectId: string
  submitterEmail: string
  submitterName: string
  generatedBy: string
}

// =============================================================================
// TEMPLATE RENDER CONTEXT
// =============================================================================

export interface TemplateRenderContext {
  clinic: {
    name: string
    address: string
    representative: string
    representative_title: string
    legal_form: string
  }
  professional: {
    full_name: string
    email: string
    phone: string
    address: string
    profession: string
    license_number: string
  }
  today: string
  pricing: {
    annexe_a_html: string
  }
}
