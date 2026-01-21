import { supabase } from '@/lib/supabaseClient'
import type { CreateClientInput } from './types'

// =============================================================================
// PHONE NUMBER NORMALIZATION (E.164)
// =============================================================================

/**
 * Normalize phone number to E.164 format
 * E.164 format: +[country code][subscriber number]
 * Example: +15145550100
 *
 * @param phone - Raw phone number input (can contain dashes, spaces, parentheses)
 * @param countryCode - Country code (default: +1 for North America)
 * @returns E.164 formatted phone number or null if invalid/empty
 */
function normalizePhoneToE164(phone: string | null | undefined, countryCode: string = '+1'): string | null {
  if (!phone) return null

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')

  if (digits.length === 0) return null

  // Handle different input formats
  // If already has country code (11+ digits starting with country code digit)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  // Standard 10-digit North American number
  if (digits.length === 10) {
    const cleanCountryCode = countryCode.startsWith('+') ? countryCode : `+${countryCode}`
    // Remove leading + from country code for concatenation, then add back
    const codeDigits = cleanCountryCode.replace(/\D/g, '')
    return `+${codeDigits}${digits}`
  }

  // If it's a shorter or longer number, just store digits with country code
  // This handles international numbers and partial numbers
  if (digits.length >= 7) {
    const cleanCountryCode = countryCode.startsWith('+') ? countryCode : `+${countryCode}`
    const codeDigits = cleanCountryCode.replace(/\D/g, '')
    return `+${codeDigits}${digits}`
  }

  // Too short to be valid, store as-is (might be extension or partial)
  return digits.length > 0 ? digits : null
}

// =============================================================================
// TYPES
// =============================================================================

export interface CreateClientResult {
  id: string
  clientId: string
}

export interface CreateClientMinimalInput {
  firstName: string
  lastName: string
  dateOfBirth?: string | null
  email?: string | null
  phone?: string | null
  language?: string
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Create a new client in the database
 * Returns the created client's UUID and generated client_id
 */
export async function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  // Normalize phone numbers to E.164 format
  const cellPhoneE164 = normalizePhoneToE164(input.cellPhone, input.cellPhoneCountryCode || '+1')
  const homePhoneE164 = normalizePhoneToE164(input.homePhone, input.homePhoneCountryCode || '+1')
  const workPhoneE164 = normalizePhoneToE164(input.workPhone, input.workPhoneCountryCode || '+1')

  const { data, error } = await supabase
    .from('clients')
    .insert({
      first_name: input.firstName,
      last_name: input.lastName,
      sex: input.sex || null,
      language: input.language || 'fr',
      birthday: input.birthday || null,
      email: input.email || null,
      cell_phone_country_code: input.cellPhoneCountryCode || '+1',
      cell_phone: cellPhoneE164,
      home_phone_country_code: input.homePhoneCountryCode || '+1',
      home_phone: homePhoneE164,
      work_phone_country_code: input.workPhoneCountryCode || '+1',
      work_phone: workPhoneE164,
      work_phone_extension: input.workPhoneExtension || null,
      street_number: input.streetNumber || null,
      street_name: input.streetName || null,
      apartment: input.apartment || null,
      city: input.city || null,
      province: input.province || null,
      country: input.country || 'Canada',
      postal_code: input.postalCode || null,
      referred_by: input.referredBy || null,
      tags: input.tags || [],
      primary_professional_id: input.primaryProfessionalId || null,
    })
    .select('id, client_id')
    .single()

  if (error) {
    console.error('[createClient] Error creating client:', error)
    throw new Error(`Failed to create client: ${error.message}`)
  }

  return {
    id: data.id,
    clientId: data.client_id,
  }
}

/**
 * Create a new client with minimal fields (used by ClientPickerDrawer)
 * Returns the created client's UUID and generated client_id
 */
export async function createClientMinimal(input: CreateClientMinimalInput): Promise<CreateClientResult> {
  // Normalize phone to E.164 format (assume +1 for minimal form)
  const phoneE164 = normalizePhoneToE164(input.phone, '+1')

  const { data, error } = await supabase
    .from('clients')
    .insert({
      first_name: input.firstName,
      last_name: input.lastName,
      birthday: input.dateOfBirth || null,
      email: input.email || null,
      cell_phone: phoneE164,
      language: input.language || 'fr',
    })
    .select('id, client_id')
    .single()

  if (error) {
    console.error('[createClientMinimal] Error creating client:', error)
    throw new Error(`Failed to create client: ${error.message}`)
  }

  return {
    id: data.id,
    clientId: data.client_id,
  }
}

// =============================================================================
// UPDATE CLIENT
// =============================================================================

export interface UpdateClientInput {
  // Identity
  firstName?: string
  lastName?: string
  sex?: string | null
  language?: string
  birthday?: string | null
  // Contact
  email?: string | null
  cellPhoneCountryCode?: string
  cellPhone?: string | null
  homePhoneCountryCode?: string
  homePhone?: string | null
  workPhoneCountryCode?: string
  workPhone?: string | null
  workPhoneExtension?: string | null
  // Address
  streetNumber?: string | null
  streetName?: string | null
  apartment?: string | null
  city?: string | null
  province?: string | null
  country?: string
  postalCode?: string | null
  // Admin
  referredBy?: string | null
  tags?: string[]
  primaryProfessionalId?: string | null
  isArchived?: boolean
}

/**
 * Update an existing client in the database
 * @param clientId - The client_id (e.g. CLI-0000001), NOT the UUID
 */
export async function updateClient(clientId: string, input: UpdateClientInput): Promise<void> {
  console.log('[updateClient] Called with clientId:', clientId, 'input:', input)

  // Build the update object, only including provided fields
  const updateData: Record<string, unknown> = {}

  if (input.firstName !== undefined) updateData.first_name = input.firstName
  if (input.lastName !== undefined) updateData.last_name = input.lastName
  if (input.sex !== undefined) updateData.sex = input.sex
  if (input.language !== undefined) updateData.language = input.language
  if (input.birthday !== undefined) updateData.birthday = input.birthday
  if (input.email !== undefined) updateData.email = input.email

  // Normalize phone numbers to E.164 format when updating
  if (input.cellPhoneCountryCode !== undefined) updateData.cell_phone_country_code = input.cellPhoneCountryCode
  if (input.cellPhone !== undefined) {
    updateData.cell_phone = normalizePhoneToE164(input.cellPhone, input.cellPhoneCountryCode || '+1')
  }
  if (input.homePhoneCountryCode !== undefined) updateData.home_phone_country_code = input.homePhoneCountryCode
  if (input.homePhone !== undefined) {
    updateData.home_phone = normalizePhoneToE164(input.homePhone, input.homePhoneCountryCode || '+1')
  }
  if (input.workPhoneCountryCode !== undefined) updateData.work_phone_country_code = input.workPhoneCountryCode
  if (input.workPhone !== undefined) {
    updateData.work_phone = normalizePhoneToE164(input.workPhone, input.workPhoneCountryCode || '+1')
  }
  if (input.workPhoneExtension !== undefined) updateData.work_phone_extension = input.workPhoneExtension

  if (input.streetNumber !== undefined) updateData.street_number = input.streetNumber
  if (input.streetName !== undefined) updateData.street_name = input.streetName
  if (input.apartment !== undefined) updateData.apartment = input.apartment
  if (input.city !== undefined) updateData.city = input.city
  if (input.province !== undefined) updateData.province = input.province
  if (input.country !== undefined) updateData.country = input.country
  if (input.postalCode !== undefined) updateData.postal_code = input.postalCode
  if (input.referredBy !== undefined) updateData.referred_by = input.referredBy
  if (input.tags !== undefined) updateData.tags = input.tags
  if (input.primaryProfessionalId !== undefined) updateData.primary_professional_id = input.primaryProfessionalId
  if (input.isArchived !== undefined) updateData.is_archived = input.isArchived

  if (Object.keys(updateData).length === 0) {
    return // Nothing to update
  }

  const { error } = await supabase
    .from('clients')
    .update(updateData)
    .eq('client_id', clientId)

  if (error) {
    console.error('[updateClient] Error updating client:', error)
    throw new Error(`Failed to update client: ${error.message}`)
  }
}
