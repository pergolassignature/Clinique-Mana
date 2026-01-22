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
  ReviewQuestionnaireInput,
  ProfessionTitle,
  ProfessionalProfession,
  ProfessionalServiceWithDetails,
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
      motifs:professional_motifs(
        professional_id,
        motif_id,
        created_at,
        motif:motifs(*)
      ),
      professions:professional_professions(
        id,
        professional_id,
        profession_title_key,
        license_number,
        is_primary,
        created_at,
        profession_title:profession_titles(*)
      ),
      documents:professional_documents(*),
      latest_invite:professional_onboarding_invites(*),
      latest_submission:professional_questionnaire_submissions(*)
    `)
    .eq('id', id)
    .order('created_at', { referencedTable: 'professional_onboarding_invites', ascending: false })
    .limit(1, { referencedTable: 'professional_onboarding_invites' })
    .order('created_at', { referencedTable: 'professional_questionnaire_submissions', ascending: false })
    .limit(1, { referencedTable: 'professional_questionnaire_submissions' })
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }

  return {
    ...data,
    latest_invite: (data.latest_invite as OnboardingInvite[])?.[0] || null,
    latest_submission: (data.latest_submission as QuestionnaireSubmission[])?.[0] || null,
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

/**
 * Create a new professional with their profile in a single operation.
 * This uses an Edge Function that creates:
 * 1. An auth.users record
 * 2. A profiles record (provider role)
 * 3. A professionals record
 * 4. Optionally an onboarding invite
 *
 * @param input - Display name, email, and whether to send an invite
 * @returns The created professional record with profile_id
 */
export interface CreateProfessionalWithProfileInput {
  displayName: string
  email: string
  sendInvite?: boolean
}

export interface CreateProfessionalWithProfileResult {
  profileId: string
  professionalId: string
  inviteId?: string
}

export async function createProfessionalWithProfile(
  input: CreateProfessionalWithProfileInput
): Promise<CreateProfessionalWithProfileResult> {
  // Get the current session for authorization
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new Error('Not authenticated')
  }

  // Call the Edge Function
  const { data, error } = await supabase.functions.invoke('create-professional', {
    body: {
      displayName: input.displayName,
      email: input.email,
      sendInvite: input.sendInvite ?? false,
    },
  })

  if (error) {
    throw new Error(error.message || 'Failed to create professional')
  }

  if (!data.success) {
    throw new Error(data.error || 'Failed to create professional')
  }

  return {
    profileId: data.profileId,
    professionalId: data.professionalId,
    inviteId: data.inviteId,
  }
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
// MOTIFS
// =============================================================================

export interface AddMotifInput {
  professional_id: string
  motif_key: string
}

export async function addProfessionalMotif(input: AddMotifInput): Promise<void> {
  // First get the motif ID from the key
  const { data: motif, error: motifError } = await supabase
    .from('motifs')
    .select('id')
    .eq('key', input.motif_key)
    .single()

  if (motifError) throw motifError
  if (!motif) throw new Error(`Motif not found: ${input.motif_key}`)

  const { error } = await supabase.from('professional_motifs').insert({
    professional_id: input.professional_id,
    motif_id: motif.id,
  })

  if (error) throw error
}

export async function removeProfessionalMotif(
  professional_id: string,
  motif_key: string
): Promise<void> {
  // First get the motif ID from the key
  const { data: motif, error: motifError } = await supabase
    .from('motifs')
    .select('id')
    .eq('key', motif_key)
    .single()

  if (motifError) throw motifError
  if (!motif) throw new Error(`Motif not found: ${motif_key}`)

  const { error } = await supabase
    .from('professional_motifs')
    .delete()
    .eq('professional_id', professional_id)
    .eq('motif_id', motif.id)

  if (error) throw error
}

/**
 * Replace all motifs for a professional (used in apply flow).
 * Deletes existing motifs and inserts new ones.
 */
export async function replaceProfessionalMotifs(
  professional_id: string,
  motif_keys: string[]
): Promise<{ replaced_count: number }> {
  // Delete all existing motifs for this professional
  const { error: deleteError } = await supabase
    .from('professional_motifs')
    .delete()
    .eq('professional_id', professional_id)

  if (deleteError) throw deleteError

  // If no new motifs, we're done
  if (!motif_keys || motif_keys.length === 0) {
    return { replaced_count: 0 }
  }

  // Get motif IDs from keys
  const { data: motifs, error: motifError } = await supabase
    .from('motifs')
    .select('id, key')
    .in('key', motif_keys)

  if (motifError) throw motifError

  // Insert new motifs
  const insertData = motifs.map((m) => ({
    professional_id,
    motif_id: m.id,
  }))

  const { error: insertError } = await supabase
    .from('professional_motifs')
    .insert(insertData)

  if (insertError) throw insertError

  return { replaced_count: motifs.length }
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

/**
 * Fetch invite with associated submission status by token.
 * Used by public invite page to enforce single-use behavior.
 */
export interface InviteWithSubmissionStatus {
  invite: OnboardingInvite
  /** Display name from the professional's profile (set when professional was created) */
  displayName: string
  hasExistingSubmission: boolean
  submissionStatus: 'draft' | 'submitted' | 'reviewed' | 'approved' | null
}

export async function fetchInviteWithSubmissionByToken(
  token: string
): Promise<InviteWithSubmissionStatus | null> {
  // First fetch the invite with professional's profile info
  const { data: invite, error: inviteError } = await supabase
    .from('professional_onboarding_invites')
    .select(`
      *,
      professionals!inner (
        profiles!inner (
          display_name
        )
      )
    `)
    .eq('token', token)
    .single()

  if (inviteError) {
    if (inviteError.code === 'PGRST116') return null // Not found
    throw inviteError
  }

  // Extract display_name from the nested join
  const displayName = (invite as { professionals?: { profiles?: { display_name?: string } } })
    ?.professionals?.profiles?.display_name || ''

  // Then fetch the latest submission for this professional
  const { data: submission, error: submissionError } = await supabase
    .from('professional_questionnaire_submissions')
    .select('status, submitted_at')
    .eq('professional_id', invite.professional_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (submissionError) throw submissionError

  // Submission exists and has been submitted (not just a draft) = form is already done
  const hasExistingSubmission =
    submission !== null &&
    submission.submitted_at !== null &&
    ['submitted', 'reviewed', 'approved'].includes(submission.status)

  return {
    invite,
    displayName,
    hasExistingSubmission,
    submissionStatus: submission?.status as 'draft' | 'submitted' | 'reviewed' | 'approved' | null,
  }
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

export interface SubmitQuestionnaireAnonInput {
  professional_id: string
  invite_id?: string
  responses: Record<string, unknown>
  /** If provided, upgrade this draft to submitted. Otherwise INSERT new. */
  existing_submission_id?: string
}

/**
 * Submit questionnaire (final submission).
 *
 * For anon users: pass existing_submission_id if a draft was previously saved.
 * This upgrades the draft to 'submitted' status.
 * Also marks the associated invite as 'completed'.
 */
export async function submitQuestionnaire(input: SubmitQuestionnaireAnonInput): Promise<QuestionnaireSubmission> {
  const now = new Date().toISOString()

  // Helper to mark invite as completed
  const markInviteCompleted = async () => {
    if (input.invite_id) {
      await supabase
        .from('professional_onboarding_invites')
        .update({
          status: 'completed',
          completed_at: now,
        })
        .eq('id', input.invite_id)
    }
  }

  if (input.existing_submission_id) {
    // Upgrade existing draft to submitted
    const { data, error } = await supabase
      .from('professional_questionnaire_submissions')
      .update({
        responses: input.responses,
        status: 'submitted',
        submitted_at: now,
        updated_at: now,
      })
      .eq('id', input.existing_submission_id)
      .eq('status', 'draft') // Safety: only upgrade drafts
      .select()
      .single()

    if (error) {
      // If update failed, fall through to insert
      console.warn('Draft upgrade failed, creating new submission:', error.message)
    } else if (data) {
      await markInviteCompleted()
      return data
    }
  }

  // Create new submission directly
  const { data, error } = await supabase
    .from('professional_questionnaire_submissions')
    .insert({
      professional_id: input.professional_id,
      invite_id: input.invite_id,
      responses: input.responses,
      status: 'submitted',
      submitted_at: now,
    })
    .select()
    .single()

  if (error) throw error

  await markInviteCompleted()
  return data
}

export interface SaveDraftInput {
  professional_id: string
  invite_id?: string
  responses: Record<string, unknown>
  /** If provided, UPDATE this submission. Otherwise INSERT new. */
  existing_submission_id?: string
}

export interface SaveDraftResult {
  submission_id: string
  updated_at: string
  is_new: boolean
}

/**
 * Save questionnaire draft for anon users.
 *
 * IMPORTANT: Anon users cannot SELECT from this table (RLS).
 * So we can't check if a draft exists. Instead:
 * - Pass existing_submission_id if you have one (from prior save or localStorage)
 * - If provided: UPDATE by ID
 * - If not provided: INSERT new draft
 */
export async function saveDraftQuestionnaire(
  input: SaveDraftInput
): Promise<SaveDraftResult> {
  const now = new Date().toISOString()

  if (input.existing_submission_id) {
    // UPDATE existing draft by ID
    // RLS allows anon UPDATE if status='draft' and valid invite exists
    const { data, error } = await supabase
      .from('professional_questionnaire_submissions')
      .update({
        responses: input.responses,
        updated_at: now,
      })
      .eq('id', input.existing_submission_id)
      .eq('status', 'draft') // Safety: only update drafts
      .select('id, updated_at')
      .single()

    if (error) {
      // If update failed (maybe row doesn't exist or isn't draft anymore),
      // fall through to insert
      console.warn('Draft update failed, attempting insert:', error.message)
    } else if (data) {
      return {
        submission_id: data.id,
        updated_at: data.updated_at,
        is_new: false,
      }
    }
  }

  // INSERT new draft
  const { data, error } = await supabase
    .from('professional_questionnaire_submissions')
    .insert({
      professional_id: input.professional_id,
      invite_id: input.invite_id,
      responses: input.responses,
      status: 'draft',
    })
    .select('id, updated_at')
    .single()

  if (error) throw error
  return {
    submission_id: data.id,
    updated_at: data.updated_at,
    is_new: true,
  }
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
// QUESTIONNAIRE APPLICATION (Apply questionnaire data to professional)
// =============================================================================

export interface ApplyQuestionnaireInput {
  professional_id: string
  submission_id: string
  // Professional fields to apply
  professional_updates: {
    portrait_bio?: string | null
    portrait_approach?: string | null
    public_email?: string | null
    public_phone?: string | null
    years_experience?: number | null
  }
  // Professions info (creates professional_professions records, max 2)
  professions?: Array<{
    profession_title_key: string
    license_number: string
    is_primary: boolean
  }>
  // Specialty codes to set (will replace existing)
  specialty_codes?: string[]
  // Motif keys to set (will replace existing)
  motif_keys?: string[]
}

export interface ApplyQuestionnaireResult {
  applied_at: string
  fields_updated: string[]
  specialties_replaced: number
  previous_specialty_count: number
  motifs_replaced: number
  previous_motif_count: number
}

/**
 * Apply questionnaire submission data to the professional record.
 * This is the "overwrite mapping" - it updates the professional and replaces specialties.
 * Follows the "single source of truth" principle: questionnaire is staging, professional is authoritative.
 *
 * Audit logging includes before/after snapshots for traceability.
 */
export async function applyQuestionnaireToProfile(input: ApplyQuestionnaireInput): Promise<ApplyQuestionnaireResult> {
  const appliedAt = new Date().toISOString()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
    .single()

  // 1. Fetch BEFORE snapshot of professional for audit
  const { data: beforeProfessional, error: fetchError } = await supabase
    .from('professionals')
    .select(`
      portrait_bio,
      portrait_approach,
      public_email,
      public_phone,
      years_experience
    `)
    .eq('id', input.professional_id)
    .single()

  if (fetchError) throw fetchError

  // 1b. Fetch existing professions for BEFORE snapshot
  const { data: beforeProfessions } = await supabase
    .from('professional_professions')
    .select('profession_title_key, license_number, is_primary')
    .eq('professional_id', input.professional_id)

  // 2. Fetch existing specialties for BEFORE snapshot
  const { data: beforeSpecialties, error: beforeSpecError } = await supabase
    .from('professional_specialties')
    .select('specialty_id, specialty:specialties(code, name_fr)')
    .eq('professional_id', input.professional_id)

  if (beforeSpecError) throw beforeSpecError

  const previousSpecialtyCount = beforeSpecialties?.length || 0
  const beforeSpecialtyCodes = beforeSpecialties?.map((ps) => {
    // Supabase may return specialty as object or array depending on the join
    const spec = ps.specialty as unknown
    if (Array.isArray(spec)) {
      return (spec[0] as { code: string })?.code
    }
    return (spec as { code: string } | null)?.code
  }).filter((code): code is string => !!code) || []

  // 2b. Fetch existing motifs for BEFORE snapshot
  const { data: beforeMotifs, error: beforeMotifsError } = await supabase
    .from('professional_motifs')
    .select('motif_id, motif:motifs(key, label)')
    .eq('professional_id', input.professional_id)

  if (beforeMotifsError) throw beforeMotifsError

  const previousMotifCount = beforeMotifs?.length || 0
  const beforeMotifKeys = beforeMotifs?.map((pm) => {
    const mot = pm.motif as unknown
    if (Array.isArray(mot)) {
      return (mot[0] as { key: string })?.key
    }
    return (mot as { key: string } | null)?.key
  }).filter((key): key is string => !!key) || []

  // 3. Build filtered updates (only include fields that have values in submission)
  // Do NOT overwrite with null if field is missing from submission
  const filteredUpdates: Record<string, string | number | null> = {}
  const fieldsUpdated: string[] = []

  for (const [key, value] of Object.entries(input.professional_updates)) {
    if (value !== undefined) {
      filteredUpdates[key] = value
      fieldsUpdated.push(key)
    }
  }

  // 4. Update professional core fields
  if (Object.keys(filteredUpdates).length > 0) {
    const { error: updateError } = await supabase
      .from('professionals')
      .update(filteredUpdates)
      .eq('id', input.professional_id)

    if (updateError) throw updateError
  }

  // 4b. Replace professions if provided (supports up to 2)
  if (input.professions && input.professions.length > 0) {
    // Delete existing professions for this professional (replace strategy)
    const { error: deleteProfError } = await supabase
      .from('professional_professions')
      .delete()
      .eq('professional_id', input.professional_id)

    if (deleteProfError) throw deleteProfError

    // Ensure exactly one is primary
    const hasPrimary = input.professions.some(p => p.is_primary)
    const professionsToInsert = input.professions.map((p, i) => ({
      professional_id: input.professional_id,
      profession_title_key: p.profession_title_key,
      license_number: p.license_number,
      is_primary: hasPrimary ? p.is_primary : i === 0,
    }))

    // Insert new professions
    const { error: insertProfError } = await supabase
      .from('professional_professions')
      .insert(professionsToInsert)

    if (insertProfError) throw insertProfError
    fieldsUpdated.push('professions')
  }

  // 5. Replace specialties if provided
  let specialtiesReplaced = 0
  if (input.specialty_codes && input.specialty_codes.length > 0) {
    // Get specialty IDs from codes
    const { data: specialties, error: specialtiesError } = await supabase
      .from('specialties')
      .select('id, code')
      .in('code', input.specialty_codes)

    if (specialtiesError) throw specialtiesError

    if (specialties && specialties.length > 0) {
      // Delete existing specialties for this professional
      const { error: deleteError } = await supabase
        .from('professional_specialties')
        .delete()
        .eq('professional_id', input.professional_id)

      if (deleteError) throw deleteError

      // Insert new specialties
      const specialtyInserts = specialties.map((s) => ({
        professional_id: input.professional_id,
        specialty_id: s.id,
      }))

      const { error: insertError } = await supabase
        .from('professional_specialties')
        .insert(specialtyInserts)

      if (insertError) throw insertError

      specialtiesReplaced = specialties.length
    }
  }

  // 5b. Replace motifs if provided
  let motifsReplaced = 0
  if (input.motif_keys && input.motif_keys.length > 0) {
    // Get motif IDs from keys
    const { data: motifs, error: motifsError } = await supabase
      .from('motifs')
      .select('id, key')
      .in('key', input.motif_keys)

    if (motifsError) throw motifsError

    if (motifs && motifs.length > 0) {
      // Delete existing motifs for this professional
      const { error: deleteError } = await supabase
        .from('professional_motifs')
        .delete()
        .eq('professional_id', input.professional_id)

      if (deleteError) throw deleteError

      // Insert new motifs
      const motifInserts = motifs.map((m) => ({
        professional_id: input.professional_id,
        motif_id: m.id,
      }))

      const { error: insertError } = await supabase
        .from('professional_motifs')
        .insert(motifInserts)

      if (insertError) throw insertError

      motifsReplaced = motifs.length
    }
  }

  // 6. Mark submission as approved
  const { error: reviewError } = await supabase
    .from('professional_questionnaire_submissions')
    .update({
      status: 'approved',
      reviewed_at: appliedAt,
      reviewed_by: profile?.id,
    })
    .eq('id', input.submission_id)

  if (reviewError) throw reviewError

  // 7. Build AFTER snapshot
  const afterSnapshot = {
    ...filteredUpdates,
    professions: input.professions || [],
    specialty_codes: input.specialty_codes || [],
    motif_keys: input.motif_keys || [],
  }

  // 8. Log audit event with before/after snapshots
  const { error: auditError } = await supabase
    .from('professional_audit_log')
    .insert({
      professional_id: input.professional_id,
      actor_id: profile?.id,
      action: 'questionnaire_approved',
      entity_type: 'questionnaire',
      entity_id: input.submission_id,
      old_value: {
        portrait_bio: beforeProfessional?.portrait_bio,
        portrait_approach: beforeProfessional?.portrait_approach,
        public_email: beforeProfessional?.public_email,
        public_phone: beforeProfessional?.public_phone,
        years_experience: beforeProfessional?.years_experience,
        professions: beforeProfessions || [],
        specialty_codes: beforeSpecialtyCodes,
        motif_keys: beforeMotifKeys,
      },
      new_value: {
        ...afterSnapshot,
        fields_updated: fieldsUpdated,
        specialties_replaced: specialtiesReplaced,
        motifs_replaced: motifsReplaced,
        submission_id: input.submission_id,
      },
    })

  if (auditError) {
    // Don't fail the operation if audit logging fails, just log it
    console.error('Failed to log audit event:', auditError)
  }

  return {
    applied_at: appliedAt,
    fields_updated: fieldsUpdated,
    specialties_replaced: specialtiesReplaced,
    previous_specialty_count: previousSpecialtyCount,
    motifs_replaced: motifsReplaced,
    previous_motif_count: previousMotifCount,
  }
}

// =============================================================================
// ANON DOCUMENT UPLOADS (for public onboarding form)
// =============================================================================

/**
 * Upload result for anon users.
 * Contains all info needed to store in questionnaire responses.
 */
export interface AnonUploadResult {
  document_id: string
  file_path: string
  file_name: string
  file_size: number
  mime_type: string
  uploaded_at: string
}

/**
 * Upload a document file as an anonymous user (via onboarding form).
 *
 * IMPORTANT: RLS policies restrict anon uploads to:
 * - document_type: 'photo' or 'insurance' only
 * - professional must have a valid (pending/opened, non-expired) invite
 *
 * The file is uploaded to Supabase Storage, then a record is inserted
 * into professional_documents. The result contains all info needed to
 * store in the questionnaire responses.uploads object.
 */
export async function uploadDocumentAnon(
  professional_id: string,
  document_type: 'photo' | 'insurance',
  file: File
): Promise<AnonUploadResult> {
  const now = new Date().toISOString()
  const timestamp = Date.now()

  // Generate unique file path: professionals/{prof_id}/{type}/{timestamp}_{filename}
  // This path pattern is enforced by storage RLS policy
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const file_path = `professionals/${professional_id}/${document_type}/${timestamp}_${safeName}`

  // 1. Upload file to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('professional-documents')
    .upload(file_path, file, {
      contentType: file.type,
      upsert: false, // Don't overwrite if exists
    })

  if (uploadError) {
    console.error('Storage upload failed:', uploadError)
    throw new Error(`Échec du téléversement: ${uploadError.message}`)
  }

  // 2. Insert document record into professional_documents
  // RLS policy validates: valid invite exists + document_type in (photo, insurance)
  const { data: doc, error: docError } = await supabase
    .from('professional_documents')
    .insert({
      professional_id,
      document_type,
      file_name: file.name,
      file_path,
      file_size: file.size,
      mime_type: file.type,
    })
    .select('id')
    .single()

  if (docError) {
    // Try to clean up the uploaded file
    await supabase.storage.from('professional-documents').remove([file_path])
    console.error('Document insert failed:', docError)
    throw new Error(`Échec de l'enregistrement: ${docError.message}`)
  }

  return {
    document_id: doc.id,
    file_path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type,
    uploaded_at: now,
  }
}

/**
 * Get a signed URL for an uploaded document (for preview).
 * Works for anon users since it only requires the file path.
 */
export async function getDocumentPreviewUrl(file_path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('professional-documents')
    .createSignedUrl(file_path, 3600) // 1 hour

  if (error) throw error
  return data.signedUrl
}

// =============================================================================
// PROFESSION TITLES
// =============================================================================

export async function fetchProfessionTitles(): Promise<ProfessionTitle[]> {
  const { data, error } = await supabase
    .from('profession_titles')
    .select('*')
    .order('label_fr')

  if (error) throw error
  return data || []
}

// =============================================================================
// PROFESSIONAL PROFESSIONS (1-2 profession titles with license numbers)
// =============================================================================

export interface AddProfessionInput {
  professional_id: string
  profession_title_key: string
  license_number: string
  is_primary: boolean
}

export async function fetchProfessionalProfessions(
  professional_id: string
): Promise<ProfessionalProfession[]> {
  const { data, error } = await supabase
    .from('professional_professions')
    .select(`
      *,
      profession_title:profession_titles(*)
    `)
    .eq('professional_id', professional_id)
    .order('is_primary', { ascending: false })

  if (error) throw error
  return data || []
}

export async function addProfessionalProfession(
  input: AddProfessionInput
): Promise<ProfessionalProfession> {
  // Check if professional already has 2 professions
  const existing = await fetchProfessionalProfessions(input.professional_id)
  if (existing.length >= 2) {
    throw new Error('Un professionnel ne peut avoir que 2 titres au maximum.')
  }

  // If this is the first profession, make it primary
  const isPrimary = existing.length === 0 ? true : input.is_primary

  // If setting this as primary, unset others
  if (isPrimary && existing.length > 0) {
    await supabase
      .from('professional_professions')
      .update({ is_primary: false })
      .eq('professional_id', input.professional_id)
  }

  const { data, error } = await supabase
    .from('professional_professions')
    .insert({
      professional_id: input.professional_id,
      profession_title_key: input.profession_title_key,
      license_number: input.license_number,
      is_primary: isPrimary,
    })
    .select(`
      *,
      profession_title:profession_titles(*)
    `)
    .single()

  if (error) throw error
  return data
}

export async function updateProfessionalProfession(
  id: string,
  updates: { license_number?: string; is_primary?: boolean }
): Promise<ProfessionalProfession> {
  // If setting as primary, we need to unset others for this professional
  if (updates.is_primary) {
    // First get the profession to find the professional_id
    const { data: prof } = await supabase
      .from('professional_professions')
      .select('professional_id')
      .eq('id', id)
      .single()

    if (prof) {
      await supabase
        .from('professional_professions')
        .update({ is_primary: false })
        .eq('professional_id', prof.professional_id)
        .neq('id', id)
    }
  }

  const { data, error } = await supabase
    .from('professional_professions')
    .update(updates)
    .eq('id', id)
    .select(`
      *,
      profession_title:profession_titles(*)
    `)
    .single()

  if (error) throw error
  return data
}

export async function removeProfessionalProfession(id: string): Promise<void> {
  const { error } = await supabase
    .from('professional_professions')
    .delete()
    .eq('id', id)

  if (error) throw error
}

/**
 * Replace all professions for a professional.
 * Used when applying questionnaire data or bulk updating.
 */
export interface ReplaceProfessionsInput {
  professional_id: string
  professions: Array<{
    profession_title_key: string
    license_number: string
    is_primary: boolean
  }>
}

export async function replaceProfessionalProfessions(
  input: ReplaceProfessionsInput
): Promise<{ replaced_count: number }> {
  // Validate max 2 professions
  if (input.professions.length > 2) {
    throw new Error('Un professionnel ne peut avoir que 2 titres au maximum.')
  }

  // Delete existing
  const { error: deleteError } = await supabase
    .from('professional_professions')
    .delete()
    .eq('professional_id', input.professional_id)

  if (deleteError) throw deleteError

  if (input.professions.length === 0) {
    return { replaced_count: 0 }
  }

  // Ensure exactly one is primary
  const hasPrimary = input.professions.some(p => p.is_primary)
  const professionsToInsert = input.professions.map((p, i) => ({
    professional_id: input.professional_id,
    profession_title_key: p.profession_title_key,
    license_number: p.license_number,
    is_primary: hasPrimary ? p.is_primary : i === 0,
  }))

  const { error: insertError } = await supabase
    .from('professional_professions')
    .insert(professionsToInsert)

  if (insertError) throw insertError

  return { replaced_count: professionsToInsert.length }
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

// =============================================================================
// PROFESSIONAL SERVICES (Junction: professionals ↔ services)
// =============================================================================

/**
 * Fetch services assigned to a professional with service details.
 */
export async function fetchProfessionalServices(
  professional_id: string
): Promise<ProfessionalServiceWithDetails[]> {
  const { data, error } = await supabase
    .from('professional_services')
    .select(`
      id,
      professional_id,
      service_id,
      is_active,
      created_at,
      updated_at,
      service:services(id, key, name_fr, default_duration_minutes)
    `)
    .eq('professional_id', professional_id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) throw error

  // Transform the joined data
  return (data || []).map((row) => ({
    ...row,
    service: row.service as unknown as {
      id: string
      key: string
      name_fr: string
      default_duration_minutes: number | null
    },
  }))
}

/**
 * Replace all services for a professional (bulk replace pattern).
 * Deletes existing active services and inserts new ones.
 * This is atomic at the application level - both operations must succeed.
 */
export async function replaceProfessionalServices(
  professional_id: string,
  service_ids: string[]
): Promise<{ replaced_count: number }> {
  // 1. Delete all existing services for this professional
  const { error: deleteError } = await supabase
    .from('professional_services')
    .delete()
    .eq('professional_id', professional_id)

  if (deleteError) throw deleteError

  // 2. If no new services, we're done
  if (!service_ids || service_ids.length === 0) {
    return { replaced_count: 0 }
  }

  // 3. Insert new services
  const insertData = service_ids.map((service_id) => ({
    professional_id,
    service_id,
    is_active: true,
  }))

  const { error: insertError } = await supabase
    .from('professional_services')
    .insert(insertData)

  if (insertError) throw insertError

  return { replaced_count: service_ids.length }
}
