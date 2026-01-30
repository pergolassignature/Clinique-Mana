// src/contracts/types.ts
// Types for contract data preparation.
// Contract generation and signing is now handled by the document-templates module.

// =============================================================================
// PROFESSIONAL SNAPSHOT (frozen at contract generation)
// =============================================================================

export interface ProfessionalSnapshot {
  id: string
  displayName: string
  publicEmail: string | null
  phoneNumber: string | null
  address: {
    streetNumber: string | null
    streetName: string | null
    apartment: string | null
    city: string | null
    province: string | null
    country: string | null
    postalCode: string | null
  }
  professions: Array<{
    titleKey: string
    titleLabel: string
    categoryKey: string
    categoryLabel: string
    licenseNumber: string | null
  }>
}

// =============================================================================
// PRICING SNAPSHOT (frozen at contract generation)
// =============================================================================

export interface PricingSnapshotRow {
  categoryKey: string
  categoryLabel: string
  duration30: number | null      // price in cents
  duration50: number | null      // price in cents
  duration60Couple: number | null // price in cents
  evaluationInitiale: number | null // price in cents
  // Professional portions (70-75% of client price)
  profPortion30Min: number | null
  profPortion30Max: number | null
  profPortion50Min: number | null
  profPortion50Max: number | null
  profPortion60Min: number | null
  profPortion60Max: number | null
  profPortionEvalMin: number | null
  profPortionEvalMax: number | null
}

export interface AutresFraisRow {
  description: string
  fraisFixe: string | null
  fraisVariable: string
}

export interface PricingSnapshot {
  rows: PricingSnapshotRow[]
  autresFrais: AutresFraisRow[]
  marginMinPercent: number // e.g., 25
  marginMaxPercent: number // e.g., 30
}

// =============================================================================
// DEPRECATED: These types are kept for backwards compatibility but no longer used.
// The document-templates module now handles contract status via DocumentInstanceStatus.
// =============================================================================

/**
 * @deprecated Use DocumentInstanceStatus from '@/document-templates/types' instead.
 */
export type ContractStatus = 'draft' | 'sent' | 'signed' | 'expired' | 'superseded'
