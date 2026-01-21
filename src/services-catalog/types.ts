// src/services-catalog/types.ts

// =============================================================================
// PRICING MODELS (from database)
// =============================================================================

export type PricingModel =
  | 'fixed'                        // Single global price
  | 'by_profession_category'       // Price varies by category + duration
  | 'rule_cancellation_prorata'    // Percentage of cancelled service
  | 'by_profession_hourly_prorata' // Minute-based billing

// =============================================================================
// SERVICES
// =============================================================================

export interface Service {
  id: string
  key: string
  name: string                     // name_fr from DB
  description?: string             // description_fr from DB
  pricingModel: PricingModel
  duration?: number                // default_duration_minutes
  displayOrder: number
  colorHex?: string
  isActive: boolean
  requiresConsent: boolean
  createdAt: string
  updatedAt: string
}

// Form data for create/edit
export interface ServiceFormData {
  name: string
  description: string
  pricingModel: PricingModel
  duration: number | null
  displayOrder: number
  colorHex: string | null
  requiresConsent: boolean
}

// =============================================================================
// PROFESSION CATEGORIES & TITLES
// =============================================================================

export interface ProfessionCategory {
  key: string
  labelFr: string
  taxIncluded: boolean  // true = prices already include TPS+TVQ
}

export interface ProfessionTitle {
  key: string
  labelFr: string
  professionCategoryKey: string
}

// =============================================================================
// SERVICE PRICES
// =============================================================================

export interface ServicePrice {
  id: string
  serviceId: string
  professionCategoryKey: string | null  // null = global price
  durationMinutes: number | null        // null = default duration
  priceCents: number
  currency: string
  isActive: boolean
}

// =============================================================================
// PROFESSION CATEGORY RATES (Hourly billing)
// =============================================================================

export interface ProfessionCategoryRate {
  id: string
  professionCategoryKey: string
  hourlyRateCents: number
  currency: string
  isActive: boolean
}

// =============================================================================
// TAX TYPES
// =============================================================================

export interface TaxRate {
  id: string
  key: string        // 'qc_gst' | 'qc_qst'
  label: string      // 'TPS' | 'TVQ'
  rateBps: number    // Basis points: 500 = 5%, 9975 = 9.975%
  region: string | null
  isActive: boolean
}

export interface ServiceTaxRule {
  id: string
  serviceId: string
  taxRateId: string
}

// Simplified tax profile for UI (single source of truth at service level)
export type ServiceTaxProfile = 'exempt' | 'tps_tvq'

// =============================================================================
// UI STATE TYPES
// =============================================================================

// Status filter type
export type ServiceStatusFilter = 'active' | 'archived' | 'all'

// Sort options
export type ServiceSortOption = 'order' | 'name' | 'duration' | 'price'

// =============================================================================
// LEGACY TYPES (for backward compatibility during migration)
// =============================================================================

// Service variant (for handling Couple/Médiation/etc without duplicating services)
// NOTE: Removed from v2 schema - variants are now service_prices with duration variants
export interface ServiceVariant {
  id: string
  label: string
  priceOverride?: number
  durationOverride?: number
}

// Internal type enum (UI-only categorization) - DEPRECATED
export type ServiceInternalType =
  | 'ouverture_dossier'
  | 'consultation'
  | 'appel_decouverte'
  | 'annulation_frais'
  | 'autre'
