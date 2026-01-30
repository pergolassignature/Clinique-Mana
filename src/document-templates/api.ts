// src/document-templates/api.ts
import { supabase } from '@/lib/supabaseClient'
import type {
  DocumentTemplate,
  DocumentInstance,
  CreateTemplateInput,
  UpdateTemplateDraftInput,
  GenerateDocumentInput,
  TemplateRenderContext,
} from './types'
import { renderTemplate } from './template-engine'
import { CLINIC_INFO, DEFAULT_AUTRES_FRAIS } from '@/contracts/constants/contract-text-fr'
import { prepareProfessionalSnapshot, preparePricingSnapshot } from '@/contracts/api'
import type { ProfessionalSnapshot, PricingSnapshot } from '@/contracts/types'

// =============================================================================
// TEMPLATE QUERIES
// =============================================================================

export async function fetchTemplates(): Promise<DocumentTemplate[]> {
  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .order('key', { ascending: true })
    .order('version', { ascending: false })

  if (error) throw error
  return data || []
}

export async function fetchTemplatesByKey(key: string): Promise<DocumentTemplate[]> {
  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .eq('key', key)
    .order('version', { ascending: false })

  if (error) throw error
  return data || []
}

export async function fetchPublishedTemplate(key: string): Promise<DocumentTemplate | null> {
  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .eq('key', key)
    .eq('status', 'published')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

export async function fetchTemplateById(id: string): Promise<DocumentTemplate | null> {
  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

// =============================================================================
// DOCUMENT INSTANCE QUERIES
// =============================================================================

/**
 * Fetch all document instances for a professional (subject).
 * Ordered by creation date descending (most recent first).
 */
export async function fetchDocumentInstancesBySubject(
  subjectType: 'professional' | 'client',
  subjectId: string
): Promise<DocumentInstance[]> {
  const { data, error } = await supabase
    .from('document_instances')
    .select('*')
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Fetch the latest (most recent) document instance for a professional by template key.
 * Returns null if no instance exists.
 */
export async function fetchLatestDocumentInstance(
  templateKey: string,
  subjectType: 'professional' | 'client',
  subjectId: string
): Promise<DocumentInstance | null> {
  const { data, error } = await supabase
    .from('document_instances')
    .select('*')
    .eq('template_key', templateKey)
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }
  return data
}

/**
 * Fetch a document instance by ID.
 */
export async function fetchDocumentInstanceById(id: string): Promise<DocumentInstance | null> {
  const { data, error } = await supabase
    .from('document_instances')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

// =============================================================================
// TEMPLATE MUTATIONS
// =============================================================================

export async function createTemplate(input: CreateTemplateInput): Promise<DocumentTemplate> {
  const { data, error } = await supabase
    .from('document_templates')
    .insert(input)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateTemplateDraft(
  id: string,
  input: UpdateTemplateDraftInput
): Promise<DocumentTemplate> {
  const { data, error } = await supabase
    .from('document_templates')
    .update({
      title: input.title,
      description: input.description,
      content: input.content,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function archiveTemplate(id: string): Promise<DocumentTemplate> {
  const { data, error } = await supabase
    .from('document_templates')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// =============================================================================
// RPC WRAPPERS
// =============================================================================

export async function publishTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc('rpc_publish_template', {
    p_template_id: id,
  })

  if (error) throw error
}

export async function createNewVersion(
  key: string,
  baseFromVersion?: number
): Promise<DocumentTemplate> {
  const { data, error } = await supabase.rpc('rpc_create_new_template_version', {
    p_key: key,
    p_base_from_version: baseFromVersion ?? null,
  })

  if (error) throw error
  return data
}

// =============================================================================
// DOCUMENT GENERATION
// =============================================================================

export async function generateDocumentFromTemplate(input: GenerateDocumentInput): Promise<{
  instanceId: string
  docusealSubmissionId: string
  signingUrl: string
}> {
  // 1. Fetch published template
  const template = await fetchPublishedTemplate(input.templateKey)
  if (!template) throw new Error(`No published template found for key: ${input.templateKey}`)

  // 2. Prepare render context
  const professionalSnapshot = await prepareProfessionalSnapshot(input.subjectId)
  const categoryKeys = professionalSnapshot.professions.map((p) => p.categoryKey)
  const pricingSnapshot = await preparePricingSnapshot(categoryKeys)

  // 3. Build render context
  const context = buildRenderContext(professionalSnapshot, pricingSnapshot)

  // 4. Render template
  const html = renderTemplate(template.content, context as unknown as Record<string, unknown>)

  // 5. Calculate expiry
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  // 6. Call DocuSeal Edge Function
  const { data: funcData, error: funcError } = await supabase.functions.invoke(
    'docuseal-create-submission',
    {
      body: {
        html,
        submitterEmail: input.submitterEmail,
        submitterName: input.submitterName,
        expiresAt: expiresAt.toISOString(),
      },
    }
  )

  if (funcError) throw new Error(funcError.message || 'Failed to create DocuSeal submission')
  if (!funcData?.success) throw new Error(funcData?.error || 'Failed to create DocuSeal submission')

  // DocuSeal response can be an array of submitters or an object
  const raw = funcData.submission
  console.log('DocuSeal response shape:', JSON.stringify(raw).slice(0, 300))

  // Normalize: extract submitter list from whichever format DocuSeal returns
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let submitters: any[]
  let submissionId: string

  if (Array.isArray(raw)) {
    // Array of submitter objects (each has submission_id, slug, email, etc.)
    submitters = raw
    submissionId = String(raw[0]?.submission_id ?? raw[0]?.id ?? '')
  } else if (raw?.submitters) {
    // Object with submitters array
    submitters = raw.submitters
    submissionId = String(raw.id ?? '')
  } else if (raw?.id && raw?.slug) {
    // Single submitter object
    submitters = [raw]
    submissionId = String(raw.submission_id ?? raw.id ?? '')
  } else {
    throw new Error(`Unexpected DocuSeal response: ${JSON.stringify(raw).slice(0, 200)}`)
  }

  if (!submitters.length) throw new Error('No submitters returned from DocuSeal')

  // Find the professional submitter (the one who hasn't completed yet)
  const professionalSubmitter =
    submitters.find((s: { completed_at?: string | null }) => !s.completed_at) ||
    submitters[submitters.length - 1]
  const signingUrl = `https://docuseal.com/s/${professionalSubmitter.slug}`

  // 7. Create document_instance record
  const { data: instance, error: insertError } = await supabase
    .from('document_instances')
    .insert({
      template_id: template.id,
      template_key: template.key,
      template_version: template.version,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      render_data: {
        context,
        professionalSnapshot,
        pricingSnapshot,
      },
      status: 'sent_to_docuseal',
      docuseal_submission_id: submissionId,
      generated_by: input.generatedBy,
    })
    .select()
    .single()

  if (insertError) throw insertError

  return {
    instanceId: instance.id,
    docusealSubmissionId: submissionId,
    signingUrl,
  }
}

// =============================================================================
// SYNC STATUS FROM DOCUSEAL
// =============================================================================

interface DocuSealSubmitter {
  id: number
  email: string
  name: string
  role: string
  status: string
  completed_at: string | null
}

interface DocuSealSubmission {
  id: number
  status: 'pending' | 'completed' | 'expired' | 'declined'
  completed_at: string | null
  combined_document_url: string | null
  documents: Array<{ name: string; url: string }>
  submitters: DocuSealSubmitter[]
  audit_log_url: string
  created_at: string
  source: string
}

/**
 * Sync document instance status from DocuSeal.
 * This is useful when the webhook didn't fire or the status is out of sync.
 *
 * Returns the updated instance or null if no update was needed.
 */
export async function syncDocumentInstanceFromDocuSeal(
  instanceId: string
): Promise<{ synced: boolean; instance: DocumentInstance | null; message: string }> {
  // 1. Get the document instance
  const instance = await fetchDocumentInstanceById(instanceId)
  if (!instance) {
    return { synced: false, instance: null, message: 'Document instance not found' }
  }

  // Already signed - no sync needed
  if (instance.status === 'signed') {
    return { synced: false, instance, message: 'Document already marked as signed' }
  }

  // No DocuSeal submission ID - can't sync
  if (!instance.docuseal_submission_id) {
    return { synced: false, instance, message: 'No DocuSeal submission ID' }
  }

  // 2. Fetch submission status from DocuSeal
  const { data: funcData, error: funcError } = await supabase.functions.invoke(
    'docuseal-get-submission',
    {
      body: { submissionId: instance.docuseal_submission_id },
    }
  )

  if (funcError) {
    throw new Error(funcError.message || 'Failed to fetch DocuSeal submission')
  }

  if (!funcData?.success) {
    throw new Error(funcData?.error || 'Failed to fetch DocuSeal submission')
  }

  const submission: DocuSealSubmission = funcData.submission

  // 3. Check if ALL submitters have completed
  const allCompleted = submission.submitters.every((s) => s.status === 'completed')

  if (!allCompleted) {
    const completedCount = submission.submitters.filter((s) => s.status === 'completed').length
    return {
      synced: false,
      instance,
      message: `En attente de signature: ${completedCount}/${submission.submitters.length} signataires complétés`,
    }
  }

  // 4. All completed - update the document instance
  const cliniqueSubmitter = submission.submitters.find((s) => s.role === 'Clinique')
  const professionnelSubmitter = submission.submitters.find((s) => s.role === 'Professionnel')
  const signedPdfUrl = submission.combined_document_url || submission.documents?.[0]?.url || null

  // Download and store PDF
  let storagePath: string | null = null
  if (signedPdfUrl && instance.subject_id) {
    try {
      const pdfResponse = await fetch(signedPdfUrl)
      if (pdfResponse.ok) {
        const pdfBlob = await pdfResponse.blob()
        const fileName = `documents/${instance.subject_id}/${instanceId}_signed.pdf`

        const { error: uploadError } = await supabase.storage
          .from('professional-documents')
          .upload(fileName, pdfBlob, {
            contentType: 'application/pdf',
            upsert: true,
          })

        if (!uploadError) {
          storagePath = fileName
        } else {
          console.error('Error uploading PDF:', uploadError)
        }
      }
    } catch (err) {
      console.error('Error downloading/uploading PDF:', err)
    }
  }

  // Download and store audit log PDF
  let auditLogStoragePath: string | null = null
  if (submission.audit_log_url && instance.subject_id) {
    try {
      const auditLogResponse = await fetch(submission.audit_log_url)
      if (auditLogResponse.ok) {
        const auditLogBlob = await auditLogResponse.blob()
        const auditLogFileName = `documents/${instance.subject_id}/${instanceId}_audit_log.pdf`

        const { error: auditUploadError } = await supabase.storage
          .from('professional-documents')
          .upload(auditLogFileName, auditLogBlob, {
            contentType: 'application/pdf',
            upsert: true,
          })

        if (!auditUploadError) {
          auditLogStoragePath = auditLogFileName
        } else {
          console.error('Error uploading audit log:', auditUploadError)
        }
      }
    } catch (err) {
      console.error('Error downloading/uploading audit log:', err)
    }
  }

  // Build audit log
  const auditLog = {
    submission_id: submission.id,
    created_at: submission.created_at,
    completed_at: submission.completed_at,
    source: submission.source,
    submitters: submission.submitters.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      role: s.role,
      status: s.status,
      completed_at: s.completed_at,
    })),
    audit_log_url: submission.audit_log_url,
    synced_manually: true,
    synced_at: new Date().toISOString(),
  }

  // 5. Update document_instance
  const { data: updated, error: updateError } = await supabase
    .from('document_instances')
    .update({
      status: 'signed',
      signed_at: professionnelSubmitter?.completed_at || submission.completed_at || new Date().toISOString(),
      signed_pdf_storage_path: storagePath,
      audit_log_storage_path: auditLogStoragePath,
      docuseal_audit_log: auditLog,
      clinic_signer_name: cliniqueSubmitter?.name || null,
      clinic_signed_at: cliniqueSubmitter?.completed_at || null,
    })
    .eq('id', instanceId)
    .select()
    .single()

  if (updateError) {
    throw new Error(`Failed to update document instance: ${updateError.message}`)
  }

  return {
    synced: true,
    instance: updated,
    message: 'Statut synchronisé avec succès - contrat signé',
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function buildRenderContext(
  professional: ProfessionalSnapshot,
  pricing: PricingSnapshot
): TemplateRenderContext {
  // Format address parts
  const addressParts: string[] = []
  const addr = professional.address
  if (addr.streetNumber || addr.streetName) {
    const street = [addr.streetNumber, addr.streetName].filter(Boolean).join(' ')
    if (addr.apartment) addressParts.push(`${street}, app. ${addr.apartment}`)
    else addressParts.push(street)
  }
  if (addr.city) {
    addressParts.push([addr.city, addr.province, addr.postalCode].filter(Boolean).join(', '))
  }

  // Format today's date in French
  const today = new Date().toLocaleDateString('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Generate Annexe A HTML using the existing pricing data
  const annexeHtml = generateAnnexeAHtml(pricing)

  return {
    clinic: {
      name: CLINIC_INFO.name,
      address: CLINIC_INFO.address,
      representative: CLINIC_INFO.representative,
      representative_title: CLINIC_INFO.representativeTitle,
      legal_form: CLINIC_INFO.legalForm,
    },
    professional: {
      full_name: professional.displayName,
      email: professional.publicEmail || '',
      phone: professional.phoneNumber || '',
      address: addressParts.join(', ') || 'N/A',
      profession:
        professional.professions.map((p) => p.titleLabel || p.categoryLabel).join(' et ') ||
        'Professionnel(le)',
      license_number: professional.professions[0]?.licenseNumber || '',
    },
    today,
    pricing: {
      annexe_a_html: annexeHtml,
    },
  }
}

function formatCents(cents: number | null): string {
  if (cents === null) return '-'
  return `${(cents / 100).toFixed(0)}$`
}

function formatPortion(min: number | null, max: number | null): string {
  if (min === null || max === null) return ''
  return `(${(min / 100).toFixed(0)}$-${(max / 100).toFixed(0)}$)`
}

function generateAnnexeAHtml(pricing: PricingSnapshot): string {
  const pricingRows = pricing.rows
    .map((row) => {
      const d60 = row.duration60Couple
        ? `${formatCents(row.duration60Couple)} <span class="portion-text">${formatPortion(row.profPortion60Min, row.profPortion60Max)}</span>`
        : '-'
      const d50 = row.duration50
        ? `${formatCents(row.duration50)} <span class="portion-text">${formatPortion(row.profPortion50Min, row.profPortion50Max)}</span>`
        : '-'
      const d30 = row.duration30
        ? `${formatCents(row.duration30)} <span class="portion-text">${formatPortion(row.profPortion30Min, row.profPortion30Max)}</span>`
        : '-'
      const evalInit = row.evaluationInitiale
        ? `${formatCents(row.evaluationInitiale)} <span class="portion-text">${formatPortion(row.profPortionEvalMin, row.profPortionEvalMax)}</span>`
        : '-'

      return `
        <tr>
          <td>${row.categoryLabel}</td>
          <td>${d60}</td>
          <td>${d50}</td>
          <td>${d30}</td>
          <td>${evalInit}</td>
        </tr>
      `
    })
    .join('')

  const autresFraisRows = DEFAULT_AUTRES_FRAIS.map(
    (row) => `
      <tr>
        <td>${row.description}</td>
        <td style="text-align: center;">${row.fraisFixe}</td>
        <td style="text-align: center;">${row.fraisVariable}</td>
      </tr>
    `
  ).join('')

  return `
    <table class="pricing-table">
      <thead>
        <tr>
          <th>Type de services</th>
          <th>Rencontre 60 min couple</th>
          <th>Rencontre 50 min.</th>
          <th>Rencontre 30 min</th>
          <th>\u00c9valuation initiale</th>
        </tr>
      </thead>
      <tbody>
        ${pricingRows}
      </tbody>
    </table>

    <p style="font-size: 9pt; color: #666; margin-top: 10px;">
      * Les montants entre parenth\u00e8ses repr\u00e9sentent la portion du professionnel (${100 - pricing.marginMaxPercent}% \u00e0 ${100 - pricing.marginMinPercent}% des honoraires)<br>
      ** Les montants incluent les taxes si applicables
    </p>

    <h4 style="margin-top: 30px;">Autres frais</h4>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="width: 100px;">Frais fixe</th>
          <th style="width: 150px;">Frais variable</th>
        </tr>
      </thead>
      <tbody>
        ${autresFraisRows}
      </tbody>
    </table>
  `
}
