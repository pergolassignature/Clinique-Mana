import { supabase } from '@/lib/supabaseClient'
import { INVERSE_RELATION_TYPES } from './types'
import type { CreateClientInput, ClientListItem, ClientWithRelations, ClientsListFilters, RelationType } from './types'

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

// =============================================================================
// FETCH FUNCTIONS
// =============================================================================

interface DbClient {
  id: string
  client_id: string
  first_name: string
  last_name: string
  birthday: string | null
  email: string | null
  cell_phone: string | null
  last_appointment_at: string | null
  is_archived: boolean
  tags: string[] | null
  primary_professional_id: string | null
}

function mapDbToClientListItem(row: DbClient): ClientListItem {
  return {
    id: row.id,
    clientId: row.client_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthday: row.birthday,
    email: row.email,
    cellPhone: row.cell_phone,
    lastAppointmentDateTime: row.last_appointment_at,
    status: row.is_archived ? 'archived' : 'active',
    tags: row.tags || [],
    primaryProfessionalId: row.primary_professional_id,
    primaryProfessionalName: null, // Would need join to get this
  }
}

/**
 * Fetch clients with optional filtering
 */
export async function fetchClients(filters?: ClientsListFilters): Promise<ClientListItem[]> {
  let query = supabase
    .from('clients')
    .select('id, client_id, first_name, last_name, birthday, email, cell_phone, last_appointment_at, is_archived, tags, primary_professional_id')
    .order('last_name', { ascending: true })

  if (filters?.status === 'active') {
    query = query.eq('is_archived', false)
  } else if (filters?.status === 'archived') {
    query = query.eq('is_archived', true)
  }

  if (filters?.search) {
    query = query.or(
      `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    )
  }

  if (filters?.primaryProfessionalId) {
    query = query.eq('primary_professional_id', filters.primaryProfessionalId)
  }

  if (filters?.tags && filters.tags.length > 0) {
    query = query.contains('tags', filters.tags)
  }

  const { data, error } = await query

  if (error) {
    console.error('[fetchClients] Error fetching clients:', error)
    throw new Error(`Failed to fetch clients: ${error.message}`)
  }

  return (data || []).map(mapDbToClientListItem)
}

/**
 * Fetch a single client by UUID
 */
export async function fetchClientById(id: string): Promise<ClientWithRelations | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    console.error('[fetchClientById] Error fetching client:', error)
    throw new Error(`Failed to fetch client: ${error.message}`)
  }

  return {
    id: data.id,
    clientId: data.client_id,
    firstName: data.first_name,
    lastName: data.last_name,
    sex: data.sex,
    language: data.language || 'fr',
    birthday: data.birthday,
    email: data.email,
    cellPhoneCountryCode: data.cell_phone_country_code || '+1',
    cellPhone: data.cell_phone,
    homePhoneCountryCode: data.home_phone_country_code || '+1',
    homePhone: data.home_phone,
    workPhoneCountryCode: data.work_phone_country_code || '+1',
    workPhone: data.work_phone,
    workPhoneExtension: data.work_phone_extension,
    streetNumber: data.street_number,
    streetName: data.street_name,
    apartment: data.apartment,
    city: data.city,
    province: data.province,
    country: data.country || 'Canada',
    postalCode: data.postal_code,
    lastAppointmentDateTime: data.last_appointment_at,
    lastAppointmentService: data.last_appointment_service,
    lastAppointmentProfessional: data.last_appointment_professional,
    primaryProfessionalId: data.primary_professional_id,
    referredBy: data.referred_by,
    customField: data.custom_field,
    tags: data.tags || [],
    createdAt: data.created_at,
    isArchived: data.is_archived || false,
    responsibleClientId: data.responsible_client_id,
  }
}

/**
 * Fetch multiple clients by their UUIDs
 */
export async function fetchClientsByIds(ids: string[]): Promise<ClientListItem[]> {
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('clients')
    .select('id, client_id, first_name, last_name, birthday, email, cell_phone, last_appointment_at, is_archived, tags, primary_professional_id')
    .in('id', ids)

  if (error) {
    console.error('[fetchClientsByIds] Error fetching clients:', error)
    throw new Error(`Failed to fetch clients: ${error.message}`)
  }

  return (data || []).map(mapDbToClientListItem)
}

// =============================================================================
// CLIENT RELATIONS (Single-row approach)
// =============================================================================
//
// Uses single-row per relationship with canonical ordering (client_a_id < client_b_id).
// The database trigger automatically enforces ordering on insert/update.
// Queries use the client_relations_expanded view for easy access from either perspective.

export interface ClientRelationInput {
  clientId: string // UUID of the source client (the one adding the relation)
  relatedClientId: string // UUID of the related client
  relationType: RelationType // What the related client is to the source (e.g., "child" if adding a child)
  notes?: string
}

export interface ClientRelationRecord {
  id: string
  clientId: string
  relatedClientId: string
  relatedClientName: string
  relationType: RelationType
  notes: string | null
  createdAt: string
}

/**
 * Check if a relation already exists between two clients
 * With single-row approach, we just need to check one direction (canonical ordering)
 */
export async function checkExistingRelation(
  clientIdA: string,
  clientIdB: string
): Promise<boolean> {
  // Canonical ordering: smaller UUID first
  const [aId, bId] = clientIdA < clientIdB
    ? [clientIdA, clientIdB]
    : [clientIdB, clientIdA]

  const { data, error } = await supabase
    .from('client_relations')
    .select('id')
    .eq('client_a_id', aId)
    .eq('client_b_id', bId)
    .limit(1)

  if (error) {
    console.error('[checkExistingRelation] Error:', error)
    throw new Error(`Failed to check existing relation: ${error.message}`)
  }

  return (data?.length ?? 0) > 0
}

/**
 * Fetch relations for a client using the expanded view
 */
export async function fetchClientRelations(clientId: string): Promise<ClientRelationRecord[]> {
  const { data, error } = await supabase
    .from('client_relations_expanded')
    .select('*')
    .eq('client_id', clientId)

  if (error) {
    console.error('[fetchClientRelations] Error:', error)
    throw new Error(`Failed to fetch client relations: ${error.message}`)
  }

  return (data || []).map(row => ({
    id: row.id,
    clientId: row.client_id,
    relatedClientId: row.related_client_id,
    relatedClientName: `${row.related_first_name} ${row.related_last_name}`,
    relationType: row.relation_type as RelationType,
    notes: row.notes,
    createdAt: row.created_at,
  }))
}

/**
 * Create a client relation (single row with both directions stored)
 *
 * @param input.clientId - The client adding the relation
 * @param input.relatedClientId - The related client
 * @param input.relationType - What the related client is to the source
 *                            (e.g., if adding "Virginie is my child", relationType = "child")
 */
export async function createClientRelation(input: ClientRelationInput): Promise<ClientRelationRecord> {
  // Validate input
  if (!input.clientId || !input.relatedClientId) {
    throw new Error('Les identifiants des clients sont requis.')
  }

  // Prevent self-relation
  if (input.clientId === input.relatedClientId) {
    throw new Error('Un client ne peut pas avoir une relation avec lui-même.')
  }

  // Check if relation already exists
  const exists = await checkExistingRelation(input.clientId, input.relatedClientId)
  if (exists) {
    throw new Error('Une relation existe déjà entre ces deux clients.')
  }

  // Get the inverse relation type
  // If user says "Virginie is my child", input.relationType = 'child'
  // The inverse is 'parent' (what the source user is to the related)
  const inverseType = INVERSE_RELATION_TYPES[input.relationType]

  // Canonical ordering: smaller UUID is always client_a
  // We need to correctly assign:
  //   relation_type_a_to_b = what A is to B
  //   relation_type_b_to_a = what B is to A
  const isSourceSmaller = input.clientId < input.relatedClientId

  const insertData = isSourceSmaller
    ? {
        // Source (input.clientId) is A, Related (input.relatedClientId) is B
        client_a_id: input.clientId,
        client_b_id: input.relatedClientId,
        relation_type_a_to_b: inverseType,        // What source is to related
        relation_type_b_to_a: input.relationType, // What related is to source
        notes: input.notes || null,
      }
    : {
        // Related (input.relatedClientId) is A, Source (input.clientId) is B
        client_a_id: input.relatedClientId,
        client_b_id: input.clientId,
        relation_type_a_to_b: input.relationType, // What related is to source
        relation_type_b_to_a: inverseType,        // What source is to related
        notes: input.notes || null,
      }

  const { data, error } = await supabase
    .from('client_relations')
    .insert(insertData)
    .select('id, created_at')
    .single()

  if (error) {
    console.error('[createClientRelation] Error:', error)
    throw new Error(`Failed to create client relation: ${error.message}`)
  }

  // Fetch the related client's name for the response
  const { data: relatedClient } = await supabase
    .from('clients')
    .select('first_name, last_name')
    .eq('id', input.relatedClientId)
    .single()

  return {
    id: data.id,
    clientId: input.clientId,
    relatedClientId: input.relatedClientId,
    relatedClientName: relatedClient
      ? `${relatedClient.first_name} ${relatedClient.last_name}`
      : 'Client inconnu',
    relationType: input.relationType,
    notes: input.notes || null,
    createdAt: data.created_at,
  }
}

/**
 * Delete a client relation (single row, automatically removes from both perspectives)
 */
export async function deleteClientRelation(relationId: string): Promise<void> {
  const { error } = await supabase
    .from('client_relations')
    .delete()
    .eq('id', relationId)

  if (error) {
    console.error('[deleteClientRelation] Error:', error)
    throw new Error(`Failed to delete client relation: ${error.message}`)
  }
}
