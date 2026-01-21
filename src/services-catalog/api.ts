// src/services-catalog/api.ts

import { supabase } from '@/lib/supabaseClient'
import type {
  Service,
  ServiceFormData,
  ProfessionCategory,
  ProfessionTitle,
  ServicePrice,
  ProfessionCategoryRate,
  PricingModel,
  TaxRate,
  ServiceTaxRule,
  ServiceTaxProfile,
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
    taxIncluded: row.tax_included ?? false,
  }))
}

/**
 * Update the tax_included (taxable) flag for a profession category.
 * When true, services for this category are taxable (TPS+TVQ will be added to pre-tax price).
 * All prices are stored as pre-tax amounts.
 */
export async function updateCategoryTaxIncluded(
  categoryKey: string,
  taxIncluded: boolean
): Promise<void> {
  const { error } = await supabase
    .from('profession_categories')
    .update({ tax_included: taxIncluded })
    .eq('key', categoryKey)

  if (error) throw error
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
// PROFESSION CATEGORY RATES (Hourly billing)
// =============================================================================

export async function fetchProfessionCategoryRates(): Promise<ProfessionCategoryRate[]> {
  const { data, error } = await supabase
    .from('profession_category_rates')
    .select('*')
    .eq('is_active', true)

  if (error) throw error

  return (data || []).map((row) => ({
    id: row.id,
    professionCategoryKey: row.profession_category_key,
    hourlyRateCents: row.hourly_rate_cents,
    currency: row.currency,
    isActive: row.is_active,
  }))
}

/**
 * Update the hourly rate for a profession category.
 */
export async function updateProfessionCategoryRate(
  categoryKey: string,
  hourlyRateCents: number
): Promise<void> {
  const { error } = await supabase
    .from('profession_category_rates')
    .upsert({
      profession_category_key: categoryKey,
      hourly_rate_cents: hourlyRateCents,
      currency: 'CAD',
      is_active: true,
    }, {
      onConflict: 'profession_category_key',
    })

  if (error) throw error
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
    isActive: row.is_active ?? true,
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
    isActive: row.is_active ?? true,
  }))
}

/**
 * Fetch all category-based prices (prices where profession_category_key is not null).
 * Used for the pricing management UI.
 */
export async function fetchCategoryPrices(): Promise<ServicePrice[]> {
  const { data, error } = await supabase
    .from('service_prices')
    .select('*')
    .not('profession_category_key', 'is', null)

  if (error) throw error

  return (data || []).map((row) => ({
    id: row.id,
    serviceId: row.service_id,
    professionCategoryKey: row.profession_category_key,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
    currency: row.currency,
    isActive: row.is_active ?? true,
  }))
}

/**
 * Input for upserting a single price
 */
export interface CategoryPriceInput {
  serviceId: string
  priceCents: number | null // null = disable the price
}

/**
 * Upsert prices for a profession category.
 * - priceCents: number = upsert the price
 * - priceCents: null = disable the price (category doesn't offer this service)
 */
export async function upsertCategoryPrices(
  categoryKey: string,
  prices: CategoryPriceInput[]
): Promise<void> {
  // Separate into disables and upserts
  const toDisable = prices.filter((p) => p.priceCents === null)
  const toUpsert = prices.filter(
    (p): p is { serviceId: string; priceCents: number } => p.priceCents !== null
  )

  // Disable prices where priceCents is null
  if (toDisable.length > 0) {
    const serviceIds = toDisable.map((p) => p.serviceId)
    const { error: disableError } = await supabase
      .from('service_prices')
      .update({ is_active: false })
      .eq('profession_category_key', categoryKey)
      .in('service_id', serviceIds)

    if (disableError) throw disableError
  }

  // Upsert prices where priceCents is a number
  if (toUpsert.length > 0) {
    const upsertData = toUpsert.map((p) => ({
      service_id: p.serviceId,
      profession_category_key: categoryKey,
      duration_minutes: null, // Use service's default duration
      price_cents: p.priceCents,
      currency: 'CAD',
      is_active: true,
    }))

    const { error: upsertError } = await supabase
      .from('service_prices')
      .upsert(upsertData, {
        onConflict: 'service_id,profession_category_key,duration_minutes',
      })

    if (upsertError) throw upsertError
  }
}

/**
 * Upsert the global base price for a service (profession_category_key = NULL).
 * - priceCents: number = upsert and activate
 * - priceCents: null = disable the base price
 */
export async function upsertServiceBasePrice(
  serviceId: string,
  priceCents: number | null
): Promise<void> {
  if (priceCents === null) {
    const { error: disableError } = await supabase
      .from('service_prices')
      .update({ is_active: false })
      .eq('service_id', serviceId)
      .is('profession_category_key', null)
      .is('duration_minutes', null)

    if (disableError) throw disableError
    return
  }

  const { error: upsertError } = await supabase
    .from('service_prices')
    .upsert(
      [
        {
          service_id: serviceId,
          profession_category_key: null,
          duration_minutes: null,
          price_cents: priceCents,
          currency: 'CAD',
          is_active: true,
        },
      ],
      {
        onConflict: 'service_id,profession_category_key,duration_minutes',
      }
    )

  if (upsertError) throw upsertError
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

// =============================================================================
// TAX RATES & RULES
// =============================================================================

/**
 * Fetch all active tax rates.
 * Cached at frontend - rarely changes.
 */
export async function fetchTaxRates(): Promise<TaxRate[]> {
  const { data, error } = await supabase
    .from('tax_rates')
    .select('*')
    .eq('is_active', true)
    .order('key')

  if (error) throw error

  return (data || []).map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    rateBps: row.rate_bps,
    region: row.region,
    isActive: row.is_active,
  }))
}

/**
 * Fetch tax rules for a specific service.
 */
export async function fetchServiceTaxRules(serviceId: string): Promise<ServiceTaxRule[]> {
  const { data, error } = await supabase
    .from('service_tax_rules')
    .select('id, service_id, tax_rate_id')
    .eq('service_id', serviceId)
    .eq('applies', true) // Only rules that apply

  if (error) throw error

  return (data || []).map((row) => ({
    id: row.id,
    serviceId: row.service_id,
    taxRateId: row.tax_rate_id,
  }))
}

/**
 * Fetch tax rules for all services (for table display).
 * Returns a map of serviceId -> tax profile.
 */
export async function fetchAllServiceTaxProfiles(): Promise<Map<string, ServiceTaxProfile>> {
  // Get all tax rules that apply
  const { data: rules, error: rulesError } = await supabase
    .from('service_tax_rules')
    .select('service_id, tax_rate_id')
    .eq('applies', true)

  if (rulesError) throw rulesError

  // Get tax rates to identify TPS and TVQ
  const { data: rates, error: ratesError } = await supabase
    .from('tax_rates')
    .select('id, key')
    .eq('is_active', true)

  if (ratesError) throw ratesError

  const tpsRate = rates?.find((r) => r.key === 'qc_gst')
  const tvqRate = rates?.find((r) => r.key === 'qc_qst')

  // Group rules by service
  const serviceRules = new Map<string, Set<string>>()
  for (const rule of rules || []) {
    if (!serviceRules.has(rule.service_id)) {
      serviceRules.set(rule.service_id, new Set())
    }
    serviceRules.get(rule.service_id)!.add(rule.tax_rate_id)
  }

  // Convert to profiles
  const profiles = new Map<string, ServiceTaxProfile>()
  for (const [serviceId, taxRateIds] of serviceRules) {
    const hasTps = tpsRate && taxRateIds.has(tpsRate.id)
    const hasTvq = tvqRate && taxRateIds.has(tvqRate.id)

    if (hasTps && hasTvq) {
      profiles.set(serviceId, 'tps_tvq')
    }
    // If only one or neither, consider exempt for now
    // (For QC, services are either both TPS+TVQ or exempt)
  }

  return profiles
}

/**
 * Set the tax profile for a service (atomic replace).
 *
 * - 'exempt': Deletes all tax rules for this service
 * - 'tps_tvq': Deletes existing rules, inserts TPS and TVQ rules
 */
export async function setServiceTaxProfile(
  serviceId: string,
  profile: ServiceTaxProfile
): Promise<void> {
  // 1. Delete existing tax rules for this service
  const { error: deleteError } = await supabase
    .from('service_tax_rules')
    .delete()
    .eq('service_id', serviceId)

  if (deleteError) throw deleteError

  // 2. If exempt, we're done
  if (profile === 'exempt') {
    return
  }

  // 3. For tps_tvq, get the tax rate IDs and insert rules
  const { data: rates, error: ratesError } = await supabase
    .from('tax_rates')
    .select('id, key')
    .in('key', ['qc_gst', 'qc_qst'])
    .eq('is_active', true)

  if (ratesError) throw ratesError

  if (!rates || rates.length < 2) {
    throw new Error('Tax rates not found. Please ensure TPS and TVQ rates are seeded.')
  }

  // 4. Insert tax rules for both TPS and TVQ
  const insertData = rates.map((rate) => ({
    service_id: serviceId,
    tax_rate_id: rate.id,
    applies: true,
    priority: rate.key === 'qc_gst' ? 1 : 2, // TPS first, then TVQ
  }))

  const { error: insertError } = await supabase
    .from('service_tax_rules')
    .insert(insertData)

  if (insertError) throw insertError
}
