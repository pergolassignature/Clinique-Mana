import { supabase } from '@/lib/supabaseClient'
import type {
  Professional,
  ProfessionalStatus,
  ProfessionalWithRelations,
  ProfessionalListItem,
  ProfessionalsListFilters,
  ProfessionalsListSort,
  Specialty,
  ProfessionalDocument,
  OnboardingInvite,
  QuestionnaireSubmission,
  ProfessionalAuditLog,
  CreateProfessionalInput,
  UpdateProfessionalInput,
  UpdateProfessionalStatusInput,
  CreateInviteInput,
  UploadDocumentInput,
  VerifyDocumentInput,
  UpdateDocumentExpiryInput,
  AddSpecialtyInput,
  SubmitQuestionnaireInput,
  ReviewQuestionnaireInput,
} from './types'

// =============================================================================
// PROFESSIONALS
// =============================================================================

export async function fetchProfessionals(
  filters?: ProfessionalsListFilters,
  sort?: ProfessionalsListSort
): Promise<ProfessionalListItem[]> {
  let query = supabase
    .from('professionals')
    .select(`
      id,
      profile_id,
      status,
      created_at,
      profile:profiles!inner(display_name, email),
      specialties:professional_specialties(count),
      documents:professional_documents(count),
      invites:professional_onboarding_invites(status)
    `)

  // Apply filters
  if (filters?.status) {
    query = query.eq('status', filters.status)
  }

  if (filters?.search) {
    query = query.or(`profile.display_name.ilike.%${filters.search}%,profile.email.ilike.%${filters.search}%`)
  }

  // Apply sorting
  if (sort) {
    const direction = sort.direction === 'desc' ? { ascending: false } : { ascending: true }
    if (sort.field === 'display_name') {
      query = query.order('profile(display_name)', direction)
    } else {
      query = query.order(sort.field, direction)
    }
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const { data, error } = await query

  if (error) throw error

  // Transform to list items
  return (data || []).map((row) => {
    const profile = row.profile as unknown as { display_name: string; email: string }
    return {
      id: row.id,
      profile_id: row.profile_id,
      display_name: profile.display_name,
      email: profile.email,
      status: row.status as ProfessionalStatus,
      specialty_count: (row.specialties as { count: number }[])?.[0]?.count || 0,
      document_count: (row.documents as { count: number }[])?.[0]?.count || 0,
      has_pending_invite: (row.invites as { status: string }[])?.some(
        (inv) => inv.status === 'pending' || inv.status === 'opened'
      ) || false,
      created_at: row.created_at,
    }
  })
}

export async function fetchProfessional(id: string): Promise<ProfessionalWithRelations | null> {
  const { data, error } = await supabase
    .from('professionals')
    .select(`
      *,
      profile:profiles!inner(id, user_id, display_name, email, role, status),
      specialties:professional_specialties(
        id,
        specialty_id,
        proficiency_level,
        created_at,
        specialty:specialties(*)
      ),
      documents:professional_documents(*),
      latest_invite:professional_onboarding_invites(*)
    `)
    .eq('id', id)
    .order('created_at', { referencedTable: 'professional_onboarding_invites', ascending: false })
    .limit(1, { referencedTable: 'professional_onboarding_invites' })
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }

  return {
    ...data,
    latest_invite: (data.latest_invite as OnboardingInvite[])?.[0] || null,
  } as ProfessionalWithRelations
}

export async function createProfessional(input: CreateProfessionalInput): Promise<Professional> {
  const { data, error } = await supabase
    .from('professionals')
    .insert(input)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateProfessional(id: string, input: UpdateProfessionalInput): Promise<Professional> {
  const { data, error } = await supabase
    .from('professionals')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateProfessionalStatus(
  id: string,
  input: UpdateProfessionalStatusInput
): Promise<Professional> {
  const { data, error } = await supabase
    .from('professionals')
    .update({ status: input.status })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// =============================================================================
// SPECIALTIES
// =============================================================================

export async function fetchSpecialties(): Promise<Specialty[]> {
  const { data, error } = await supabase
    .from('specialties')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('sort_order')

  if (error) throw error
  return data || []
}

export async function fetchSpecialtiesByCategory(): Promise<Record<string, Specialty[]>> {
  const specialties = await fetchSpecialties()

  return specialties.reduce<Record<string, Specialty[]>>(
    (acc, specialty) => {
      const category = specialty.category
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category]!.push(specialty)
      return acc
    },
    {}
  )
}

export async function addProfessionalSpecialty(input: AddSpecialtyInput): Promise<void> {
  const { error } = await supabase.from('professional_specialties').insert(input)

  if (error) throw error
}

export async function removeProfessionalSpecialty(
  professional_id: string,
  specialty_id: string
): Promise<void> {
  const { error } = await supabase
    .from('professional_specialties')
    .delete()
    .eq('professional_id', professional_id)
    .eq('specialty_id', specialty_id)

  if (error) throw error
}

// =============================================================================
// DOCUMENTS
// =============================================================================

export async function fetchProfessionalDocuments(professional_id: string): Promise<ProfessionalDocument[]> {
  const { data, error } = await supabase
    .from('professional_documents')
    .select('*')
    .eq('professional_id', professional_id)
    .order('document_type')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function uploadDocument(input: UploadDocumentInput): Promise<ProfessionalDocument> {
  const { data, error } = await supabase
    .from('professional_documents')
    .insert(input)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function verifyDocument(input: VerifyDocumentInput): Promise<ProfessionalDocument> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
    .single()

  const updateData = input.verified
    ? { verified_at: new Date().toISOString(), verified_by: profile?.id }
    : { verified_at: null, verified_by: null }

  const { data, error } = await supabase
    .from('professional_documents')
    .update(updateData)
    .eq('id', input.id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateDocumentExpiry(input: UpdateDocumentExpiryInput): Promise<ProfessionalDocument> {
  const { data, error } = await supabase
    .from('professional_documents')
    .update({ expires_at: input.expires_at })
    .eq('id', input.id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteDocument(id: string): Promise<void> {
  // First get the document to get the file path
  const { data: doc } = await supabase
    .from('professional_documents')
    .select('file_path')
    .eq('id', id)
    .single()

  // Delete from storage
  if (doc?.file_path) {
    await supabase.storage.from('professional-documents').remove([doc.file_path])
  }

  // Delete from database
  const { error } = await supabase.from('professional_documents').delete().eq('id', id)

  if (error) throw error
}

export async function getDocumentDownloadUrl(file_path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('professional-documents')
    .createSignedUrl(file_path, 3600) // 1 hour expiry

  if (error) throw error
  return data.signedUrl
}

// =============================================================================
// INVITES
// =============================================================================

export async function fetchProfessionalInvites(professional_id: string): Promise<OnboardingInvite[]> {
  const { data, error } = await supabase
    .from('professional_onboarding_invites')
    .select('*')
    .eq('professional_id', professional_id)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createInvite(input: CreateInviteInput): Promise<OnboardingInvite> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
    .single()

  const { data, error } = await supabase
    .from('professional_onboarding_invites')
    .insert({
      ...input,
      sent_by: profile?.id,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function markInviteSent(id: string): Promise<OnboardingInvite> {
  const { data, error } = await supabase
    .from('professional_onboarding_invites')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function revokeInvite(id: string): Promise<OnboardingInvite> {
  const { data, error } = await supabase
    .from('professional_onboarding_invites')
    .update({ status: 'revoked' })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// Public functions (for invite page - uses anon key)
export async function fetchInviteByToken(token: string): Promise<OnboardingInvite | null> {
  const { data, error } = await supabase
    .from('professional_onboarding_invites')
    .select('*')
    .eq('token', token)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }

  return data
}

export async function markInviteOpened(token: string): Promise<void> {
  const { error } = await supabase
    .from('professional_onboarding_invites')
    .update({
      status: 'opened',
      opened_at: new Date().toISOString(),
    })
    .eq('token', token)
    .eq('status', 'pending')

  if (error) throw error
}

// =============================================================================
// QUESTIONNAIRE SUBMISSIONS
// =============================================================================

export async function fetchQuestionnaireSubmission(
  professional_id: string
): Promise<QuestionnaireSubmission | null> {
  const { data, error } = await supabase
    .from('professional_questionnaire_submissions')
    .select('*')
    .eq('professional_id', professional_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }

  return data
}

export async function submitQuestionnaire(input: SubmitQuestionnaireInput): Promise<QuestionnaireSubmission> {
  // Check if there's an existing draft
  const existing = await fetchQuestionnaireSubmission(input.professional_id)

  if (existing && existing.status === 'draft') {
    // Update existing draft
    const { data, error } = await supabase
      .from('professional_questionnaire_submissions')
      .update({
        responses: input.responses,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw error
    return data
  }

  // Create new submission
  const { data, error } = await supabase
    .from('professional_questionnaire_submissions')
    .insert({
      professional_id: input.professional_id,
      invite_id: input.invite_id,
      responses: input.responses,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function saveDraftQuestionnaire(
  input: SubmitQuestionnaireInput
): Promise<QuestionnaireSubmission> {
  // Check if there's an existing draft
  const existing = await fetchQuestionnaireSubmission(input.professional_id)

  if (existing && existing.status === 'draft') {
    // Update existing draft
    const { data, error } = await supabase
      .from('professional_questionnaire_submissions')
      .update({
        responses: input.responses,
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw error
    return data
  }

  // Create new draft
  const { data, error } = await supabase
    .from('professional_questionnaire_submissions')
    .insert({
      professional_id: input.professional_id,
      invite_id: input.invite_id,
      responses: input.responses,
      status: 'draft',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function reviewQuestionnaire(input: ReviewQuestionnaireInput): Promise<QuestionnaireSubmission> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
    .single()

  const { data, error } = await supabase
    .from('professional_questionnaire_submissions')
    .update({
      status: input.status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: profile?.id,
      review_notes: input.review_notes,
    })
    .eq('id', input.id)
    .select()
    .single()

  if (error) throw error
  return data
}

// =============================================================================
// AUDIT LOG
// =============================================================================

export async function fetchProfessionalAuditLog(professional_id: string): Promise<ProfessionalAuditLog[]> {
  const { data, error } = await supabase
    .from('professional_audit_log')
    .select(`
      *,
      actor:profiles!professional_audit_log_actor_id_fkey(display_name)
    `)
    .eq('professional_id', professional_id)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}
