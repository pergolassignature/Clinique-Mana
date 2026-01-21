import { supabase } from '@/lib/supabaseClient'
import type {
  ClinicSettings,
  ProfessionalIvacNumber,
  ClientExternalPayer,
  ClientExternalPayerIvac,
  ClientExternalPayerPae,
  CreateIvacPayerInput,
  UpdateIvacPayerInput,
  CreatePaePayerInput,
  UpdatePaePayerInput,
  UpdateClinicSettingsInput,
  UpsertProfessionalIvacNumberInput,
} from './types'

// =============================================================================
// CLINIC SETTINGS
// =============================================================================

const CLINIC_SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

export async function fetchClinicSettings(): Promise<ClinicSettings> {
  const { data, error } = await supabase
    .from('clinic_settings')
    .select('*')
    .eq('id', CLINIC_SETTINGS_ID)
    .single()

  if (error) throw error
  return data as ClinicSettings
}

export async function updateClinicSettings(
  input: UpdateClinicSettingsInput
): Promise<ClinicSettings> {
  const { data, error } = await supabase
    .from('clinic_settings')
    .update({
      ivac_provider_number: input.ivac_provider_number,
    })
    .eq('id', CLINIC_SETTINGS_ID)
    .select()
    .single()

  if (error) throw error
  return data as ClinicSettings
}

// =============================================================================
// PROFESSIONAL IVAC NUMBERS
// =============================================================================

export async function fetchProfessionalIvacNumber(
  professional_id: string
): Promise<ProfessionalIvacNumber | null> {
  const { data, error } = await supabase
    .from('professional_ivac_numbers')
    .select('*')
    .eq('professional_id', professional_id)
    .maybeSingle()

  if (error) throw error
  return data as ProfessionalIvacNumber | null
}

export async function fetchAllProfessionalIvacNumbers(): Promise<ProfessionalIvacNumber[]> {
  const { data, error } = await supabase
    .from('professional_ivac_numbers')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as ProfessionalIvacNumber[]
}

export async function upsertProfessionalIvacNumber(
  input: UpsertProfessionalIvacNumberInput
): Promise<ProfessionalIvacNumber> {
  const { data, error } = await supabase
    .from('professional_ivac_numbers')
    .upsert(
      {
        professional_id: input.professional_id,
        ivac_number: input.ivac_number,
      },
      { onConflict: 'professional_id' }
    )
    .select()
    .single()

  if (error) throw error
  return data as ProfessionalIvacNumber
}

export async function deleteProfessionalIvacNumber(professional_id: string): Promise<void> {
  const { error } = await supabase
    .from('professional_ivac_numbers')
    .delete()
    .eq('professional_id', professional_id)

  if (error) throw error
}

// =============================================================================
// CLIENT EXTERNAL PAYERS
// =============================================================================

export async function fetchClientExternalPayers(
  client_id: string
): Promise<ClientExternalPayer[]> {
  // Fetch base payers with IVAC and PAE details
  const { data, error } = await supabase
    .from('client_external_payers')
    .select(`
      *,
      ivac_details:client_payer_ivac(*),
      pae_details:client_payer_pae(*)
    `)
    .eq('client_id', client_id)
    .order('payer_type')

  if (error) throw error

  // Transform to typed objects
  return (data || []).map((row) => {
    if (row.payer_type === 'ivac') {
      return {
        id: row.id,
        client_id: row.client_id,
        payer_type: 'ivac' as const,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        ivac_details: row.ivac_details,
      } as ClientExternalPayerIvac
    } else {
      return {
        id: row.id,
        client_id: row.client_id,
        payer_type: 'pae' as const,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        pae_details: row.pae_details,
      } as ClientExternalPayerPae
    }
  })
}

export async function fetchActiveClientExternalPayers(
  client_id: string
): Promise<ClientExternalPayer[]> {
  const payers = await fetchClientExternalPayers(client_id)
  return payers.filter((p) => p.is_active)
}

// =============================================================================
// IVAC PAYER CRUD
// =============================================================================

export async function createIvacPayer(
  input: CreateIvacPayerInput
): Promise<ClientExternalPayerIvac> {
  // 1. Create base record
  const { data: base, error: baseError } = await supabase
    .from('client_external_payers')
    .insert({
      client_id: input.client_id,
      payer_type: 'ivac',
      is_active: true,
    })
    .select()
    .single()

  if (baseError) throw baseError

  // 2. Create IVAC details
  const { data: ivac, error: ivacError } = await supabase
    .from('client_payer_ivac')
    .insert({
      payer_id: base.id,
      file_number: input.file_number,
      event_date: input.event_date || null,
      expiry_date: input.expiry_date || null,
    })
    .select()
    .single()

  if (ivacError) {
    // Cleanup base record on failure
    await supabase.from('client_external_payers').delete().eq('id', base.id)
    throw ivacError
  }

  return {
    id: base.id,
    client_id: base.client_id,
    payer_type: 'ivac',
    is_active: base.is_active,
    created_at: base.created_at,
    updated_at: base.updated_at,
    ivac_details: ivac,
  }
}

export async function updateIvacPayer(
  payer_id: string,
  input: UpdateIvacPayerInput
): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (input.file_number !== undefined) updates.file_number = input.file_number
  if (input.event_date !== undefined) updates.event_date = input.event_date
  if (input.expiry_date !== undefined) updates.expiry_date = input.expiry_date

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('client_payer_ivac')
      .update(updates)
      .eq('payer_id', payer_id)

    if (error) throw error
  }
}

// =============================================================================
// PAE PAYER CRUD
// =============================================================================

export async function createPaePayer(
  input: CreatePaePayerInput
): Promise<ClientExternalPayerPae> {
  // 1. Create base record
  const { data: base, error: baseError } = await supabase
    .from('client_external_payers')
    .insert({
      client_id: input.client_id,
      payer_type: 'pae',
      is_active: true,
    })
    .select()
    .single()

  if (baseError) throw baseError

  // 2. Create PAE details
  const { data: pae, error: paeError } = await supabase
    .from('client_payer_pae')
    .insert({
      payer_id: base.id,
      file_number: input.file_number,
      employer_name: input.employer_name || null,
      pae_provider_name: input.pae_provider_name,
      file_opening_fee: input.file_opening_fee ?? false,
      reimbursement_percentage: input.reimbursement_percentage,
      maximum_amount_cents: input.maximum_amount_cents,
      expiry_date: input.expiry_date,
      coverage_rules: input.coverage_rules || [],
    })
    .select()
    .single()

  if (paeError) {
    // Cleanup base record on failure
    await supabase.from('client_external_payers').delete().eq('id', base.id)
    throw paeError
  }

  return {
    id: base.id,
    client_id: base.client_id,
    payer_type: 'pae',
    is_active: base.is_active,
    created_at: base.created_at,
    updated_at: base.updated_at,
    pae_details: pae,
  }
}

export async function updatePaePayer(
  payer_id: string,
  input: UpdatePaePayerInput
): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (input.file_number !== undefined) updates.file_number = input.file_number
  if (input.employer_name !== undefined) updates.employer_name = input.employer_name
  if (input.pae_provider_name !== undefined) updates.pae_provider_name = input.pae_provider_name
  if (input.file_opening_fee !== undefined) updates.file_opening_fee = input.file_opening_fee
  if (input.reimbursement_percentage !== undefined) updates.reimbursement_percentage = input.reimbursement_percentage
  if (input.maximum_amount_cents !== undefined) updates.maximum_amount_cents = input.maximum_amount_cents
  if (input.expiry_date !== undefined) updates.expiry_date = input.expiry_date
  if (input.coverage_rules !== undefined) updates.coverage_rules = input.coverage_rules
  if (input.appointments_used !== undefined) updates.appointments_used = input.appointments_used
  if (input.amount_used_cents !== undefined) updates.amount_used_cents = input.amount_used_cents

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('client_payer_pae')
      .update(updates)
      .eq('payer_id', payer_id)

    if (error) throw error
  }
}

// =============================================================================
// DEACTIVATE PAYER (soft delete)
// =============================================================================

export async function deactivateExternalPayer(payer_id: string): Promise<void> {
  const { error } = await supabase
    .from('client_external_payers')
    .update({ is_active: false })
    .eq('id', payer_id)

  if (error) throw error
}

export async function reactivateExternalPayer(payer_id: string): Promise<void> {
  const { error } = await supabase
    .from('client_external_payers')
    .update({ is_active: true })
    .eq('id', payer_id)

  if (error) throw error
}

// =============================================================================
// DELETE PAYER (hard delete - admin only)
// =============================================================================

export async function deleteExternalPayer(payer_id: string): Promise<void> {
  const { error } = await supabase
    .from('client_external_payers')
    .delete()
    .eq('id', payer_id)

  if (error) throw error
}
