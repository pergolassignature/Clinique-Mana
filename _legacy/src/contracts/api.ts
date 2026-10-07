// src/contracts/api.ts
// This module provides data preparation utilities for contract generation.
// The actual contract generation and signing is now handled by the document-templates module.

import { supabase } from '@/lib/supabaseClient'
import type {
  ProfessionalSnapshot,
  PricingSnapshot,
  PricingSnapshotRow,
} from './types'
import { calculateProfessionalPortion, DEFAULT_MARGIN } from './constants/pricing-margin'

// =============================================================================
// DATA PREPARATION
// =============================================================================

/**
 * Prepare a snapshot of professional data for contract generation.
 * This captures the professional's info at the time of contract creation.
 */
export async function prepareProfessionalSnapshot(
  professionalId: string
): Promise<ProfessionalSnapshot> {
  const { data, error } = await supabase
    .from('professionals')
    .select(
      `
      id,
      public_email,
      phone_number,
      street_number,
      street_name,
      apartment,
      city,
      province,
      country,
      postal_code,
      profile:profiles!professionals_profile_id_fkey (
        display_name,
        email
      ),
      professions:professional_professions (
        is_primary,
        license_number,
        profession_title:profession_titles (
          key,
          label_fr,
          profession_category:profession_categories (
            key,
            label_fr
          )
        )
      )
    `
    )
    .eq('id', professionalId)
    .single()

  if (error) throw error

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = data.profile as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const professions = data.professions as any[]

  return {
    id: data.id,
    displayName: profile?.display_name || '',
    publicEmail: data.public_email,
    phoneNumber: data.phone_number,
    address: {
      streetNumber: data.street_number,
      streetName: data.street_name,
      apartment: data.apartment,
      city: data.city,
      province: data.province,
      country: data.country,
      postalCode: data.postal_code,
    },
    professions: (professions || []).map((p) => ({
      titleKey: p.profession_title?.key || '',
      titleLabel: p.profession_title?.label_fr || '',
      categoryKey: p.profession_title?.profession_category?.key || '',
      categoryLabel: p.profession_title?.profession_category?.label_fr || '',
      licenseNumber: p.license_number,
    })),
  }
}

/**
 * Prepare a snapshot of pricing data for contract generation.
 * This captures the pricing structure at the time of contract creation.
 */
export async function preparePricingSnapshot(
  categoryKeys: string[]
): Promise<PricingSnapshot> {
  // Fetch service prices for the relevant categories
  // Note: prices are stored with duration_minutes=null, use service's default_duration_minutes
  const { data: prices, error: pricesError } = await supabase
    .from('service_prices')
    .select(
      `
      price_cents,
      duration_minutes,
      profession_category_key,
      service:services (
        key,
        name_fr,
        pricing_model,
        default_duration_minutes
      )
    `
    )
    .in('profession_category_key', categoryKeys)
    .eq('is_active', true)

  if (pricesError) throw pricesError

  // Fetch category labels
  const { data: categories, error: categoriesError } = await supabase
    .from('profession_categories')
    .select('key, label_fr')
    .in('key', categoryKeys)

  if (categoriesError) throw categoriesError

  const categoryLabels = new Map(categories?.map((c) => [c.key, c.label_fr]) || [])

  // Group prices by category
  const rows: PricingSnapshotRow[] = categoryKeys.map((categoryKey) => {
    const categoryPrices = (prices || []).filter(
      (p) => p.profession_category_key === categoryKey
    )

    // Find prices by service's default duration (or price's duration if specified)
    // Prices are stored with duration_minutes=null, so we use the service's default_duration_minutes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findByDuration = (targetDuration: number) => categoryPrices.find((p: any) => {
      const service = p.service as { pricing_model?: string; default_duration_minutes?: number } | null
      if (service?.pricing_model !== 'by_profession_category') return false
      // Use price's duration_minutes if set, otherwise use service's default
      const duration = p.duration_minutes ?? service?.default_duration_minutes
      return duration === targetDuration
    })

    const find30 = findByDuration(30)
    const find50 = findByDuration(50)
    const find60 = findByDuration(60)

    const row: PricingSnapshotRow = {
      categoryKey,
      categoryLabel: categoryLabels.get(categoryKey) || categoryKey,
      duration30: find30?.price_cents || null,
      duration50: find50?.price_cents || null,
      duration60Couple: find60?.price_cents || null,
      evaluationInitiale: null, // Not all categories have this
      profPortion30Min: null,
      profPortion30Max: null,
      profPortion50Min: null,
      profPortion50Max: null,
      profPortion60Min: null,
      profPortion60Max: null,
      profPortionEvalMin: null,
      profPortionEvalMax: null,
    }

    // Calculate professional portions
    if (row.duration30) {
      const portion = calculateProfessionalPortion(row.duration30)
      row.profPortion30Min = portion.min
      row.profPortion30Max = portion.max
    }
    if (row.duration50) {
      const portion = calculateProfessionalPortion(row.duration50)
      row.profPortion50Min = portion.min
      row.profPortion50Max = portion.max
    }
    if (row.duration60Couple) {
      const portion = calculateProfessionalPortion(row.duration60Couple)
      row.profPortion60Min = portion.min
      row.profPortion60Max = portion.max
    }
    if (row.evaluationInitiale) {
      const portion = calculateProfessionalPortion(row.evaluationInitiale)
      row.profPortionEvalMin = portion.min
      row.profPortionEvalMax = portion.max
    }

    return row
  })

  return {
    rows,
    autresFrais: [
      { description: 'Échange avec intervenant externe', fraisFixe: null, fraisVariable: '100% honoraires' },
      { description: 'Rédaction de rapport', fraisFixe: null, fraisVariable: '100% honoraires' },
    ],
    marginMinPercent: DEFAULT_MARGIN.min,
    marginMaxPercent: DEFAULT_MARGIN.max,
  }
}
