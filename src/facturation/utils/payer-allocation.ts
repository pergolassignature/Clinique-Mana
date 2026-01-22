// src/facturation/utils/payer-allocation.ts
// Utilities for calculating external payer allocations (IVAC and PAE)

import { supabase } from '@/lib/supabaseClient'
import {
  IVAC_RATE_CENTS,
  type ClientExternalPayer,
  type ClientExternalPayerIvac,
  type ClientExternalPayerPae,
  type PAECoverageRule,
} from '@/external-payers/types'

// =============================================================================
// TYPES
// =============================================================================

export interface PayerAllocationResult {
  payerCoversCents: number
  clientPaysCents: number
  ruleApplied: string | null
  ruleDetails: string | null
}

export interface IvacAllocationResult extends PayerAllocationResult {
  ivacRateCents: number
}

export interface PaeAllocationResult extends PayerAllocationResult {
  paePercentage: number | null
}

// =============================================================================
// IVAC ALLOCATION
// =============================================================================

/**
 * Calculate IVAC allocation for an appointment.
 * IVAC pays a fixed rate per appointment ($94.50).
 * Client pays the difference if service price > IVAC rate.
 *
 * @param servicePriceCents - The total service price in cents
 */
export function calculateIvacAllocation(servicePriceCents: number): IvacAllocationResult {
  // IVAC pays fixed rate, client pays remainder
  const payerCoversCents = Math.min(IVAC_RATE_CENTS, servicePriceCents)
  const clientPaysCents = Math.max(0, servicePriceCents - IVAC_RATE_CENTS)

  return {
    payerCoversCents,
    clientPaysCents,
    ivacRateCents: IVAC_RATE_CENTS,
    ruleApplied: 'fixed_rate',
    ruleDetails: `Taux fixe IVAC: ${(IVAC_RATE_CENTS / 100).toFixed(2)} $`,
  }
}

// =============================================================================
// PAE ALLOCATION
// =============================================================================

/**
 * Calculate PAE allocation based on coverage rules.
 * PAE programs have flexible rules that determine coverage.
 *
 * @param totalCents - The total invoice amount in cents
 * @param paeDetails - The PAE payer details with coverage rules
 * @param appointmentNumber - Which appointment this is (1-indexed) for the client with this PAE
 */
export function calculatePaeAllocation(
  totalCents: number,
  paeDetails: {
    coverage_rules: PAECoverageRule[]
    appointments_used: number
    amount_used_cents: number
    maximum_amount_cents: number
    reimbursement_percentage: number
  },
  appointmentNumber: number
): PaeAllocationResult {
  // Check if budget is exhausted
  const remainingBudget = paeDetails.maximum_amount_cents - paeDetails.amount_used_cents

  if (remainingBudget <= 0) {
    return {
      payerCoversCents: 0,
      clientPaysCents: totalCents,
      paePercentage: null,
      ruleApplied: 'budget_exhausted',
      ruleDetails: 'Budget PAE épuisé',
    }
  }

  // Sort rules by order
  const sortedRules = [...paeDetails.coverage_rules].sort((a, b) => a.order - b.order)

  // Find applicable rule
  for (const rule of sortedRules) {
    switch (rule.type) {
      case 'free_appointments': {
        if (appointmentNumber <= rule.appointment_count) {
          const payerCoversCents = Math.min(totalCents, remainingBudget)
          return {
            payerCoversCents,
            clientPaysCents: totalCents - payerCoversCents,
            paePercentage: 100,
            ruleApplied: 'free_appointments',
            ruleDetails: `Rendez-vous ${appointmentNumber} de ${rule.appointment_count} gratuits`,
          }
        }
        break
      }

      case 'shared_cost': {
        if (appointmentNumber >= rule.from_appointment) {
          const paePercentage = rule.pae_percentage
          let payerCoversCents = Math.round(totalCents * (paePercentage / 100))

          // Cap at remaining budget
          payerCoversCents = Math.min(payerCoversCents, remainingBudget)

          return {
            payerCoversCents,
            clientPaysCents: totalCents - payerCoversCents,
            paePercentage,
            ruleApplied: 'shared_cost',
            ruleDetails: `PAE couvre ${paePercentage}% à partir du rendez-vous ${rule.from_appointment}`,
          }
        }
        break
      }

      case 'fixed_client_amount': {
        if (appointmentNumber >= rule.from_appointment) {
          const clientPaysCents = Math.min(rule.client_amount_cents, totalCents)
          let payerCoversCents = totalCents - clientPaysCents

          // Cap at remaining budget
          payerCoversCents = Math.min(payerCoversCents, remainingBudget)

          return {
            payerCoversCents,
            clientPaysCents: totalCents - payerCoversCents,
            paePercentage: null,
            ruleApplied: 'fixed_client_amount',
            ruleDetails: `Client paie ${(rule.client_amount_cents / 100).toFixed(2)} $ par rendez-vous`,
          }
        }
        break
      }

      case 'included_services': {
        // This rule type filters which services are covered, not the amount
        // Assumes the service is already validated as covered
        break
      }
    }
  }

  // No specific rule matched - use default reimbursement percentage
  if (paeDetails.reimbursement_percentage > 0) {
    const paePercentage = paeDetails.reimbursement_percentage
    let payerCoversCents = Math.round(totalCents * (paePercentage / 100))

    // Cap at remaining budget
    payerCoversCents = Math.min(payerCoversCents, remainingBudget)

    return {
      payerCoversCents,
      clientPaysCents: totalCents - payerCoversCents,
      paePercentage,
      ruleApplied: 'default_percentage',
      ruleDetails: `Remboursement standard ${paePercentage}%`,
    }
  }

  // No coverage
  return {
    payerCoversCents: 0,
    clientPaysCents: totalCents,
    paePercentage: null,
    ruleApplied: null,
    ruleDetails: null,
  }
}

// =============================================================================
// PAYER LOOKUP
// =============================================================================

/**
 * Fetch active external payers for a client.
 *
 * @param clientId - The client ID
 */
export async function fetchClientActivePayers(
  clientId: string
): Promise<ClientExternalPayer[]> {
  // Fetch base payer records
  const { data: payers, error: payersError } = await supabase
    .from('client_external_payers')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)

  if (payersError) throw payersError
  if (!payers || payers.length === 0) return []

  // Fetch IVAC details
  const ivacPayerIds = payers.filter(p => p.payer_type === 'ivac').map(p => p.id)
  const { data: ivacDetails, error: ivacError } = await supabase
    .from('client_payer_ivac')
    .select('*')
    .in('payer_id', ivacPayerIds)

  if (ivacError) throw ivacError

  // Fetch PAE details
  const paePayerIds = payers.filter(p => p.payer_type === 'pae').map(p => p.id)
  const { data: paeDetails, error: paeError } = await supabase
    .from('client_payer_pae')
    .select('*')
    .in('payer_id', paePayerIds)

  if (paeError) throw paeError

  // Combine into full payer objects
  const result: ClientExternalPayer[] = []

  for (const payer of payers) {
    if (payer.payer_type === 'ivac') {
      const details = ivacDetails?.find(d => d.payer_id === payer.id)
      if (details) {
        result.push({
          ...payer,
          payer_type: 'ivac',
          ivac_details: details,
        } as ClientExternalPayerIvac)
      }
    } else if (payer.payer_type === 'pae') {
      const details = paeDetails?.find(d => d.payer_id === payer.id)
      if (details) {
        result.push({
          ...payer,
          payer_type: 'pae',
          pae_details: details,
        } as ClientExternalPayerPae)
      }
    }
  }

  return result
}

/**
 * Get the count of appointments already invoiced for a client with a specific PAE.
 * Used to determine which coverage rule applies (appointmentNumber).
 *
 * @param _clientId - The client ID (reserved for future filtering needs)
 * @param payerId - The external payer ID
 */
export async function getAppointmentCountForPayer(
  _clientId: string,
  payerId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('invoice_payer_allocations')
    .select('id', { count: 'exact', head: true })
    .eq('client_external_payer_id', payerId)

  if (error) throw error

  return (count || 0) + 1 // Return next appointment number
}

/**
 * Update PAE usage tracking after creating an allocation.
 *
 * @param payerId - The PAE payer ID
 * @param amountCents - Amount allocated in cents
 */
export async function updatePaeUsage(
  payerId: string,
  amountCents: number
): Promise<void> {
  const { data: current, error: fetchError } = await supabase
    .from('client_payer_pae')
    .select('appointments_used, amount_used_cents')
    .eq('payer_id', payerId)
    .single()

  if (fetchError) throw fetchError

  const { error: updateError } = await supabase
    .from('client_payer_pae')
    .update({
      appointments_used: (current?.appointments_used || 0) + 1,
      amount_used_cents: (current?.amount_used_cents || 0) + amountCents,
    })
    .eq('payer_id', payerId)

  if (updateError) throw updateError
}

// =============================================================================
// BUDGET DISPLAY HELPERS
// =============================================================================

/**
 * Calculate remaining budget percentage for PAE.
 *
 * @param paeDetails - The PAE details
 */
export function getPaeBudgetPercentUsed(paeDetails: {
  amount_used_cents: number
  maximum_amount_cents: number
}): number {
  if (paeDetails.maximum_amount_cents === 0) return 100
  return Math.round(
    (paeDetails.amount_used_cents / paeDetails.maximum_amount_cents) * 100
  )
}

/**
 * Format remaining PAE budget for display.
 *
 * @param paeDetails - The PAE details
 */
export function formatPaeRemainingBudget(paeDetails: {
  amount_used_cents: number
  maximum_amount_cents: number
}): string {
  const remainingCents = paeDetails.maximum_amount_cents - paeDetails.amount_used_cents
  const remainingDollars = remainingCents / 100
  return remainingDollars.toLocaleString('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  })
}

/**
 * Check if PAE is expiring soon (within 30 days).
 *
 * @param expiryDate - ISO date string
 */
export function isPaeExpiringSoon(expiryDate: string): boolean {
  const expiry = new Date(expiryDate)
  const thirtyDaysFromNow = new Date()
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
  return expiry <= thirtyDaysFromNow
}

/**
 * Check if PAE is expired.
 *
 * @param expiryDate - ISO date string
 */
export function isPaeExpired(expiryDate: string): boolean {
  const expiry = new Date(expiryDate)
  return expiry < new Date()
}
