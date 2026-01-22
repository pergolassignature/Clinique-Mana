import { supabase } from '@/lib/supabaseClient'
import type { DemandType, UrgencyLevel, ParticipantRole, ConsentStatus } from './types'

// =============================================================================
// INPUT TYPES
// =============================================================================

export interface CreateDemandeInput {
  demandType: DemandType | null
  selectedMotifs: string[]
  motifDescription: string
  otherMotifText: string
  urgency: UrgencyLevel | null
  notes: string
  // Intake fields
  besoinRaison: string
  enjeuxHasIssues: 'yes' | 'no' | ''
  enjeuxDemarche: string[]
  enjeuxComment: string
  diagnosticStatus: 'yes' | 'no' | ''
  diagnosticDetail: string
  hasConsulted: 'yes' | 'no' | ''
  consultationsPrevious: string[]
  consultationsComment: string
  hasLegalContext: 'yes' | 'no' | ''
  legalContext: string[]
  legalContextDetail: string
  // Schedule preferences (multi-select)
  schedulePreferences: Array<'am' | 'pm' | 'evening' | 'weekend' | 'other'>
  schedulePreferenceDetail: string
  // Participants
  participants: Array<{
    clientId: string
    role: ParticipantRole
    consentStatus: ConsentStatus
    consentVersion?: string
    consentSignedAt?: string
  }>
}

export interface UpdateDemandeInput extends Partial<CreateDemandeInput> {
  status?: 'toAnalyze' | 'assigned' | 'closed'
}

export interface AssignDemandeInput {
  professionalId: string
  assignedBy: string // profile ID of the person assigning
}

export interface DemandeWithParticipants {
  id: string
  demandeId: string
  status: 'toAnalyze' | 'assigned' | 'closed'
  demandType: DemandType | null
  selectedMotifs: string[]
  motifDescription: string
  otherMotifText: string
  urgency: UrgencyLevel | null
  notes: string
  besoinRaison: string
  enjeuxHasIssues: 'yes' | 'no' | null
  enjeuxDemarche: string[]
  enjeuxComment: string
  diagnosticStatus: 'yes' | 'no' | null
  diagnosticDetail: string
  hasConsulted: 'yes' | 'no' | null
  consultationsPrevious: string[]
  consultationsComment: string
  hasLegalContext: 'yes' | 'no' | null
  legalContext: string[]
  legalContextDetail: string
  schedulePreferences: Array<'am' | 'pm' | 'evening' | 'weekend' | 'other'>
  schedulePreferenceDetail: string
  createdAt: string
  updatedAt: string
  participants: Array<{
    id: string
    clientId: string
    clientName: string
    role: ParticipantRole
    consentStatus: ConsentStatus
    consentVersion: string | null
    consentSignedAt: string | null
  }>
}

// =============================================================================
// CREATE DEMANDE
// =============================================================================

export async function createDemande(input: CreateDemandeInput): Promise<DemandeWithParticipants> {
  // Insert the demande
  const { data: demande, error: demandeError } = await supabase
    .from('demandes')
    .insert({
      demand_type: input.demandType,
      selected_motifs: input.selectedMotifs,
      motif_description: input.motifDescription,
      other_motif_text: input.otherMotifText,
      urgency: input.urgency,
      notes: input.notes,
      besoin_raison: input.besoinRaison,
      enjeux_has_issues: input.enjeuxHasIssues || null,
      enjeux_demarche: input.enjeuxDemarche,
      enjeux_comment: input.enjeuxComment,
      diagnostic_status: input.diagnosticStatus || null,
      diagnostic_detail: input.diagnosticDetail,
      has_consulted: input.hasConsulted || null,
      consultations_previous: input.consultationsPrevious,
      consultations_comment: input.consultationsComment,
      has_legal_context: input.hasLegalContext || null,
      legal_context: input.legalContext,
      legal_context_detail: input.legalContextDetail,
      schedule_preferences: input.schedulePreferences || [],
      schedule_preference_detail: input.schedulePreferenceDetail || '',
    })
    .select()
    .single()

  if (demandeError) throw demandeError

  // Insert participants if any
  if (input.participants.length > 0) {
    const participantsToInsert = input.participants.map(p => ({
      demande_id: demande.id,
      client_id: p.clientId,
      role: p.role,
      consent_status: p.consentStatus,
      consent_version: p.consentVersion || null,
      consent_signed_at: p.consentSignedAt || null,
    }))

    const { error: participantsError } = await supabase
      .from('demande_participants')
      .insert(participantsToInsert)

    if (participantsError) throw participantsError
  }

  // Fetch the complete demande with participants
  return fetchDemande(demande.demande_id)
}

// =============================================================================
// UPDATE DEMANDE
// =============================================================================

export async function updateDemande(demandeId: string, input: UpdateDemandeInput): Promise<DemandeWithParticipants> {
  // First get the demande UUID from the display ID
  const { data: existingDemande, error: fetchError } = await supabase
    .from('demandes')
    .select('id')
    .eq('demande_id', demandeId)
    .single()

  if (fetchError) throw fetchError

  // Build update object
  const updateData: Record<string, unknown> = {}

  if (input.demandType !== undefined) updateData.demand_type = input.demandType
  if (input.selectedMotifs !== undefined) updateData.selected_motifs = input.selectedMotifs
  if (input.motifDescription !== undefined) updateData.motif_description = input.motifDescription
  if (input.otherMotifText !== undefined) updateData.other_motif_text = input.otherMotifText
  if (input.urgency !== undefined) updateData.urgency = input.urgency
  if (input.notes !== undefined) updateData.notes = input.notes
  if (input.status !== undefined) updateData.status = input.status
  if (input.besoinRaison !== undefined) updateData.besoin_raison = input.besoinRaison
  if (input.enjeuxHasIssues !== undefined) updateData.enjeux_has_issues = input.enjeuxHasIssues || null
  if (input.enjeuxDemarche !== undefined) updateData.enjeux_demarche = input.enjeuxDemarche
  if (input.enjeuxComment !== undefined) updateData.enjeux_comment = input.enjeuxComment
  if (input.diagnosticStatus !== undefined) updateData.diagnostic_status = input.diagnosticStatus || null
  if (input.diagnosticDetail !== undefined) updateData.diagnostic_detail = input.diagnosticDetail
  if (input.hasConsulted !== undefined) updateData.has_consulted = input.hasConsulted || null
  if (input.consultationsPrevious !== undefined) updateData.consultations_previous = input.consultationsPrevious
  if (input.consultationsComment !== undefined) updateData.consultations_comment = input.consultationsComment
  if (input.hasLegalContext !== undefined) updateData.has_legal_context = input.hasLegalContext || null
  if (input.legalContext !== undefined) updateData.legal_context = input.legalContext
  if (input.legalContextDetail !== undefined) updateData.legal_context_detail = input.legalContextDetail
  if (input.schedulePreferences !== undefined) updateData.schedule_preferences = input.schedulePreferences || []
  if (input.schedulePreferenceDetail !== undefined) updateData.schedule_preference_detail = input.schedulePreferenceDetail

  // Update the demande
  if (Object.keys(updateData).length > 0) {
    const { error: updateError } = await supabase
      .from('demandes')
      .update(updateData)
      .eq('id', existingDemande.id)

    if (updateError) throw updateError
  }

  // Update participants if provided
  if (input.participants !== undefined) {
    // Delete existing participants
    const { error: deleteError } = await supabase
      .from('demande_participants')
      .delete()
      .eq('demande_id', existingDemande.id)

    if (deleteError) throw deleteError

    // Insert new participants
    if (input.participants.length > 0) {
      const participantsToInsert = input.participants.map(p => ({
        demande_id: existingDemande.id,
        client_id: p.clientId,
        role: p.role,
        consent_status: p.consentStatus,
        consent_version: p.consentVersion || null,
        consent_signed_at: p.consentSignedAt || null,
      }))

      const { error: insertError } = await supabase
        .from('demande_participants')
        .insert(participantsToInsert)

      if (insertError) throw insertError
    }
  }

  // Fetch and return the updated demande
  return fetchDemande(demandeId)
}

// =============================================================================
// FETCH DEMANDE
// =============================================================================

export async function fetchDemande(demandeId: string): Promise<DemandeWithParticipants> {
  const { data, error } = await supabase
    .from('demandes')
    .select(`
      id,
      demande_id,
      status,
      demand_type,
      selected_motifs,
      motif_description,
      other_motif_text,
      urgency,
      notes,
      besoin_raison,
      enjeux_has_issues,
      enjeux_demarche,
      enjeux_comment,
      diagnostic_status,
      diagnostic_detail,
      has_consulted,
      consultations_previous,
      consultations_comment,
      has_legal_context,
      legal_context,
      legal_context_detail,
      schedule_preferences,
      schedule_preference_detail,
      created_at,
      updated_at,
      demande_participants (
        id,
        client_id,
        role,
        consent_status,
        consent_version,
        consent_signed_at,
        clients:client_id (
          first_name,
          last_name
        )
      )
    `)
    .eq('demande_id', demandeId)
    .single()

  if (error) throw error

  const participants = (data.demande_participants as unknown as Array<{
    id: string
    client_id: string
    role: ParticipantRole
    consent_status: ConsentStatus
    consent_version: string | null
    consent_signed_at: string | null
    clients: { first_name: string; last_name: string } | null
  }>) || []

  return {
    id: data.id,
    demandeId: data.demande_id,
    status: data.status,
    demandType: data.demand_type,
    selectedMotifs: data.selected_motifs || [],
    motifDescription: data.motif_description || '',
    otherMotifText: data.other_motif_text || '',
    urgency: data.urgency,
    notes: data.notes || '',
    besoinRaison: data.besoin_raison || '',
    enjeuxHasIssues: data.enjeux_has_issues,
    enjeuxDemarche: data.enjeux_demarche || [],
    enjeuxComment: data.enjeux_comment || '',
    diagnosticStatus: data.diagnostic_status,
    diagnosticDetail: data.diagnostic_detail || '',
    hasConsulted: data.has_consulted,
    consultationsPrevious: data.consultations_previous || [],
    consultationsComment: data.consultations_comment || '',
    hasLegalContext: data.has_legal_context,
    legalContext: data.legal_context || [],
    legalContextDetail: data.legal_context_detail || '',
    schedulePreferences: data.schedule_preferences || [],
    schedulePreferenceDetail: data.schedule_preference_detail || '',
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    participants: participants.map(p => ({
      id: p.id,
      clientId: p.client_id,
      clientName: p.clients ? `${p.clients.first_name} ${p.clients.last_name}` : 'Client inconnu',
      role: p.role,
      consentStatus: p.consent_status,
      consentVersion: p.consent_version,
      consentSignedAt: p.consent_signed_at,
    })),
  }
}

// =============================================================================
// ASSIGN PROFESSIONAL TO DEMANDE
// =============================================================================

export async function assignDemande(
  demandeId: string,
  input: AssignDemandeInput
): Promise<DemandeWithParticipants> {
  // First get the demande UUID and participants from the display ID
  const { data: existingDemande, error: fetchError } = await supabase
    .from('demandes')
    .select(`
      id,
      demande_participants (
        client_id,
        role
      )
    `)
    .eq('demande_id', demandeId)
    .single()

  if (fetchError) throw fetchError

  // Update the demande with assignment info
  const { error: updateError } = await supabase
    .from('demandes')
    .update({
      status: 'assigned',
      assigned_professional_id: input.professionalId,
      assigned_at: new Date().toISOString(),
      assigned_by: input.assignedBy,
    })
    .eq('id', existingDemande.id)

  if (updateError) throw updateError

  // Find all participants and update their primary_professional_id
  // For 'primary' role, this is the main client
  // For 'secondary' roles, they might also need the professional assigned
  const participants = (existingDemande.demande_participants as Array<{
    client_id: string
    role: ParticipantRole
  }>) || []

  // Update primary_professional_id for all participants who don't have one yet
  // This ensures the assigned professional becomes the primary for clients in this demande
  if (participants.length > 0) {
    const clientIds = participants.map(p => p.client_id)

    // Only update clients who don't already have a primary professional
    const { error: clientUpdateError } = await supabase
      .from('clients')
      .update({ primary_professional_id: input.professionalId })
      .in('id', clientIds)
      .is('primary_professional_id', null)

    if (clientUpdateError) {
      console.error('Failed to update client primary_professional_id:', clientUpdateError)
      // Don't throw - the demande assignment succeeded, this is a secondary operation
    }
  }

  // Fetch and return the updated demande
  return fetchDemande(demandeId)
}
