// src/facturation/utils/new-client-detection.ts
// Logic for detecting new clients and determining if "Ouverture de dossier" fee applies

import { supabase } from '@/lib/supabaseClient'
import type { NewClientStatus } from '../types'

// =============================================================================
// NEW CLIENT DETECTION
// =============================================================================

/**
 * Determine if a client qualifies for "Ouverture de dossier" fee.
 *
 * Returns:
 * - 'new_client' if: client has no prior invoices AND no related clients have prior invoices
 * - 'existing_relation' if: client has no prior invoices BUT at least one related client has prior invoices
 * - null if client already has invoice history
 *
 * This logic ensures that:
 * - Truly new clients pay the file opening fee
 * - New clients who are related to existing clients (e.g., a child of an existing parent)
 *   are tagged but may not need to pay (business decision)
 *
 * @param clientId - The client ID to check
 */
export async function detectNewClientStatus(clientId: string): Promise<NewClientStatus> {
  // 1. Check if client has any prior non-void invoices
  const { count: clientInvoiceCount, error: clientError } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .neq('status', 'void')

  if (clientError) throw clientError

  // If client has invoice history, they're not new
  if (clientInvoiceCount && clientInvoiceCount > 0) {
    return {
      isNew: false,
      hasRelationWithHistory: false,
      suggestedTag: null,
      shouldAddFileOpeningFee: false,
    }
  }

  // 2. Get all related clients via the expanded view
  // The view shows relationships from both directions
  const { data: relations, error: relationsError } = await supabase
    .from('client_relations_expanded')
    .select('related_client_id')
    .eq('client_id', clientId)

  if (relationsError) throw relationsError

  // No relations means definitely new client
  if (!relations || relations.length === 0) {
    return {
      isNew: true,
      hasRelationWithHistory: false,
      suggestedTag: 'new_client',
      shouldAddFileOpeningFee: true,
    }
  }

  // 3. Check if any related client has invoice history
  const relatedIds = relations.map(r => r.related_client_id)

  const { count: relatedInvoiceCount, error: relatedError } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .in('client_id', relatedIds)
    .neq('status', 'void')

  if (relatedError) throw relatedError

  // Has relations with invoice history
  if (relatedInvoiceCount && relatedInvoiceCount > 0) {
    return {
      isNew: true,
      hasRelationWithHistory: true,
      suggestedTag: 'existing_relation',
      shouldAddFileOpeningFee: false, // Family already has a file
    }
  }

  // No family history either - truly new
  return {
    isNew: true,
    hasRelationWithHistory: false,
    suggestedTag: 'new_client',
    shouldAddFileOpeningFee: true,
  }
}

/**
 * Tag a client based on their new client status.
 * Adds 'new_client' or 'existing_relation' to the client's tags array.
 *
 * @param clientId - The client ID to tag
 * @param tag - The tag to add
 */
export async function tagNewClient(
  clientId: string,
  tag: 'new_client' | 'existing_relation'
): Promise<void> {
  // Get current tags
  const { data: client, error: fetchError } = await supabase
    .from('clients')
    .select('tags')
    .eq('id', clientId)
    .single()

  if (fetchError) throw fetchError

  const currentTags = client?.tags || []

  // Don't add duplicate tags
  if (currentTags.includes(tag)) {
    return
  }

  // Add the new tag
  const updatedTags = [...currentTags, tag]

  const { error: updateError } = await supabase
    .from('clients')
    .update({ tags: updatedTags })
    .eq('id', clientId)

  if (updateError) throw updateError
}

/**
 * Check if a client already has a specific tag.
 *
 * @param clientId - The client ID to check
 * @param tag - The tag to look for
 */
export async function clientHasTag(
  clientId: string,
  tag: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('clients')
    .select('tags')
    .eq('id', clientId)
    .single()

  if (error) throw error

  return data?.tags?.includes(tag) ?? false
}

/**
 * Get the "Ouverture de dossier" service ID.
 * This service should have key = 'ouverture_dossier'.
 */
export async function getFileOpeningServiceId(): Promise<string | null> {
  const { data, error } = await supabase
    .from('services')
    .select('id')
    .eq('key', 'ouverture_dossier')
    .eq('is_active', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }

  return data?.id || null
}

/**
 * Check if the file opening service exists.
 * Useful for UI to know whether to show the option.
 */
export async function fileOpeningServiceExists(): Promise<boolean> {
  const serviceId = await getFileOpeningServiceId()
  return serviceId !== null
}
