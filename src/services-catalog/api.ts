// src/services-catalog/api.ts

import { supabase } from '@/lib/supabaseClient'
import type {
  Service,
  ServiceFormData,
  ProfessionCategory,
  ProfessionTitle,
  ServicePrice,
  PricingModel,
} from './types'

// =============================================================================
// SERVICES
// =============================================================================

interface DbService {
  id: string
  key: string
  name_fr: string
  description_fr: string | null
  pricing_model: PricingModel
  default_duration_minutes: number | null
  display_order: number
  color_hex: string | null
  is_active: boolean
  requires_consent: boolean
  created_at: string
  updated_at: string
}

export async function fetchServices(): Promise<Service[]> {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .order('display_order')

  if (error) throw error

  return (data || []).map(mapDbServiceToService)
}

export async function fetchActiveServices(): Promise<Service[]> {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('is_active', true)
    .order('display_order')

  if (error) throw error

  return (data || []).map(mapDbServiceToService)
}

export async function fetchServiceById(id: string): Promise<Service | null> {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  return mapDbServiceToService(data)
}

export async function createService(input: ServiceFormData): Promise<Service> {
  const { data, error } = await supabase
    .from('services')
    .insert({
      key: generateServiceKey(input.name),
      name_fr: input.name,
      description_fr: input.description || null,
      pricing_model: input.pricingModel,
      default_duration_minutes: input.duration || null,
      display_order: input.displayOrder,
      color_hex: input.colorHex || null,
      requires_consent: input.requiresConsent,
    })
    .select()
    .single()

  if (error) throw error
  return mapDbServiceToService(data)
}

export async function updateService(
  id: string,
  input: Partial<ServiceFormData>
): Promise<Service> {
  const updateData: Record<string, unknown> = {}

  if (input.name !== undefined) updateData.name_fr = input.name
  if (input.description !== undefined) updateData.description_fr = input.description || null
  if (input.pricingModel !== undefined) updateData.pricing_model = input.pricingModel
  if (input.duration !== undefined) updateData.default_duration_minutes = input.duration || null
  if (input.displayOrder !== undefined) updateData.display_order = input.displayOrder
  if (input.colorHex !== undefined) updateData.color_hex = input.colorHex || null
  if (input.requiresConsent !== undefined) updateData.requires_consent = input.requiresConsent

  const { data, error } = await supabase
    .from('services')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapDbServiceToService(data)
}

export async function archiveService(id: string): Promise<Service> {
  const { data, error } = await supabase
    .from('services')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapDbServiceToService(data)
}

export async function restoreService(id: string): Promise<Service> {
  const { data, error } = await supabase
    .from('services')
    .update({ is_active: true })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapDbServiceToService(data)
}

// =============================================================================
// PROFESSION CATEGORIES & TITLES
// =============================================================================

export async function fetchProfessionCategories(): Promise<ProfessionCategory[]> {
  const { data, error } = await supabase
    .from('profession_categories')
    .select('*')
    .order('label_fr')

  if (error) throw error

  return (data || []).map((row) => ({
    key: row.key,
    labelFr: row.label_fr,
  }))
}

export async function fetchProfessionTitles(): Promise<ProfessionTitle[]> {
  const { data, error } = await supabase
    .from('profession_titles')
    .select('*')
    .order('label_fr')

  if (error) throw error

  return (data || []).map((row) => ({
    key: row.key,
    labelFr: row.label_fr,
    professionCategoryKey: row.profession_category_key,
  }))
}

// =============================================================================
// SERVICE PRICES
// =============================================================================

export async function fetchServicePrices(serviceId: string): Promise<ServicePrice[]> {
  const { data, error } = await supabase
    .from('service_prices')
    .select('*')
    .eq('service_id', serviceId)

  if (error) throw error

  return (data || []).map((row) => ({
    id: row.id,
    serviceId: row.service_id,
    professionCategoryKey: row.profession_category_key,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
    currency: row.currency,
  }))
}

export async function fetchAllServicePrices(): Promise<ServicePrice[]> {
  const { data, error } = await supabase
    .from('service_prices')
    .select('*')

  if (error) throw error

  return (data || []).map((row) => ({
    id: row.id,
    serviceId: row.service_id,
    professionCategoryKey: row.profession_category_key,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
    currency: row.currency,
  }))
}

// =============================================================================
// HELPERS
// =============================================================================

function mapDbServiceToService(row: DbService): Service {
  return {
    id: row.id,
    key: row.key,
    name: row.name_fr,
    description: row.description_fr || undefined,
    pricingModel: row.pricing_model,
    duration: row.default_duration_minutes || undefined,
    displayOrder: row.display_order,
    colorHex: row.color_hex || undefined,
    isActive: row.is_active,
    requiresConsent: row.requires_consent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function generateServiceKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}
