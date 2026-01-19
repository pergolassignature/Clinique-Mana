// src/services-catalog/types.ts

// Service variant (for handling Couple/Médiation/etc without duplicating services)
export interface ServiceVariant {
  id: string
  label: string
  priceOverride?: number  // If null/undefined, uses parent price
  durationOverride?: number  // If null/undefined, uses parent duration
}

// Internal type enum (UI-only categorization)
export type ServiceInternalType =
  | 'ouverture_dossier'
  | 'consultation'
  | 'appel_decouverte'
  | 'annulation_frais'
  | 'autre'

// Main service type
export interface Service {
  id: string
  name: string
  description?: string
  duration: number  // minutes
  price: number  // dollars (allow 0)
  isOnlineAvailable: boolean
  internalType: ServiceInternalType
  variants: ServiceVariant[]
  isActive: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

// Form data for create/edit (subset of Service)
export interface ServiceFormData {
  name: string
  description: string
  duration: number
  price: number
  isOnlineAvailable: boolean
  internalType: ServiceInternalType
  variants: Omit<ServiceVariant, 'id'>[]
}

// Status filter type
export type ServiceStatusFilter = 'active' | 'archived' | 'all'

// Sort options
export type ServiceSortOption = 'order' | 'name' | 'duration' | 'price'
