// src/facturation/utils/pricing.ts
// Price calculation utilities for the facturation module

import type { Service, ServicePrice, ProfessionCategoryRate, ProfessionCategory } from '@/services-catalog/types'
import type { CalculatedPrice, LineItemCalculation, QuantityUnit } from '../types'
import { QC_TPS_RATE, QC_TVQ_RATE } from '@/utils/tax'

// =============================================================================
// SERVICE PRICE CALCULATION
// =============================================================================

/**
 * Calculate the price for a service based on:
 * 1. Service pricing_model
 * 2. Professional's profession category
 * 3. Appointment duration (for prorata)
 *
 * @param service - The service being billed
 * @param professionCategoryKey - The professional's category (e.g., 'psychologie')
 * @param durationMinutes - Appointment duration for minute-based billing
 * @param servicePrices - All service prices to look up
 * @param categoryRates - Hourly rates for minute-based billing
 * @param categories - Profession categories to check tax status
 */
export function calculateServicePrice(
  service: Service,
  professionCategoryKey: string,
  durationMinutes: number,
  servicePrices: ServicePrice[],
  categoryRates: ProfessionCategoryRate[],
  categories: ProfessionCategory[]
): CalculatedPrice {
  // Determine if taxable
  const isTaxable = determineIsTaxable(service, professionCategoryKey, categories)

  let unitPriceCents: number
  let quantityUnit: QuantityUnit
  let quantity: number

  switch (service.pricingModel) {
    case 'fixed': {
      // Get global price (profession_category_key = null)
      const fixedPrice = servicePrices.find(
        p => p.serviceId === service.id && !p.professionCategoryKey && p.isActive
      )
      unitPriceCents = fixedPrice?.priceCents ?? 0
      quantityUnit = 'unit'
      quantity = 1
      break
    }

    case 'by_profession_category': {
      // Get category-specific price
      const categoryPrice = servicePrices.find(
        p => p.serviceId === service.id &&
             p.professionCategoryKey === professionCategoryKey &&
             p.isActive
      )
      unitPriceCents = categoryPrice?.priceCents ?? 0
      quantityUnit = 'unit'
      quantity = 1
      break
    }

    case 'by_profession_hourly_prorata': {
      // Minute-based billing
      const rate = categoryRates.find(
        r => r.professionCategoryKey === professionCategoryKey && r.isActive
      )
      // Unit price is per minute (hourly rate / 60)
      unitPriceCents = rate ? Math.round(rate.hourlyRateCents / 60) : 0
      quantityUnit = 'minute'
      quantity = durationMinutes
      break
    }

    case 'rule_cancellation_prorata': {
      // This should be calculated from the original service price
      // When creating a cancellation fee, use calculateCancellationFee instead
      throw new Error('Use calculateCancellationFee for cancellation prorata pricing')
    }

    default:
      unitPriceCents = 0
      quantityUnit = 'unit'
      quantity = 1
  }

  // Calculate totals
  const subtotalCents = Math.round(unitPriceCents * quantity)

  let taxTpsCents = 0
  let taxTvqCents = 0
  if (isTaxable) {
    taxTpsCents = Math.round(subtotalCents * QC_TPS_RATE)
    taxTvqCents = Math.round(subtotalCents * QC_TVQ_RATE)
  }

  const totalCents = subtotalCents + taxTpsCents + taxTvqCents

  return {
    unitPriceCents,
    quantityUnit,
    quantity,
    subtotalCents,
    isTaxable,
    taxTpsCents,
    taxTvqCents,
    totalCents,
  }
}

/**
 * Determine if a service is taxable based on:
 * 1. Service's is_taxable_override (if not null, use it)
 * 2. Profession category's tax_included flag
 * 3. Default: not taxable (exempt)
 *
 * @param service - The service
 * @param professionCategoryKey - The professional's category
 * @param categories - All profession categories
 */
export function determineIsTaxable(
  service: Service,
  professionCategoryKey: string,
  categories: ProfessionCategory[]
): boolean {
  // 1. Service-level override takes priority
  if (service.isTaxableOverride !== null && service.isTaxableOverride !== undefined) {
    return service.isTaxableOverride
  }

  // 2. Check profession category's tax setting
  const category = categories.find(c => c.key === professionCategoryKey)
  if (category) {
    // tax_included === true means the category is taxable
    return category.taxIncluded
  }

  // 3. Default: not taxable (exempt)
  return false
}

// =============================================================================
// CANCELLATION FEE CALCULATION
// =============================================================================

/**
 * Calculate a cancellation fee based on:
 * - Original service price
 * - Cancellation fee percentage (from appointment)
 *
 * @param originalPriceCents - The original service price (pre-tax)
 * @param feePercent - The percentage to charge (0-100)
 * @param isTaxable - Whether the fee is taxable
 */
export function calculateCancellationFee(
  originalPriceCents: number,
  feePercent: number,
  isTaxable: boolean
): CalculatedPrice {
  const unitPriceCents = Math.round(originalPriceCents * (feePercent / 100))

  let taxTpsCents = 0
  let taxTvqCents = 0
  if (isTaxable) {
    taxTpsCents = Math.round(unitPriceCents * QC_TPS_RATE)
    taxTvqCents = Math.round(unitPriceCents * QC_TVQ_RATE)
  }

  return {
    unitPriceCents,
    quantityUnit: 'unit',
    quantity: 1,
    subtotalCents: unitPriceCents,
    isTaxable,
    taxTpsCents,
    taxTvqCents,
    totalCents: unitPriceCents + taxTpsCents + taxTvqCents,
  }
}

// =============================================================================
// LINE ITEM CALCULATION
// =============================================================================

/**
 * Calculate line item totals with discount and tax.
 *
 * @param unitPriceCents - Price per unit (pre-tax)
 * @param quantity - Number of units
 * @param discountType - 'percent' or 'fixed' or null
 * @param discountValue - Percent (0-100) or cents
 * @param isTaxable - Whether to apply tax
 */
export function calculateLineItemTotals(
  unitPriceCents: number,
  quantity: number,
  discountType: 'percent' | 'fixed' | null,
  discountValue: number | null,
  isTaxable: boolean
): LineItemCalculation {
  const subtotalCents = Math.round(unitPriceCents * quantity)

  let discountCents = 0
  if (discountType && discountValue) {
    if (discountType === 'percent') {
      discountCents = Math.round(subtotalCents * (discountValue / 100))
    } else {
      discountCents = Math.round(discountValue)
    }
  }

  const afterDiscountCents = subtotalCents - discountCents

  let taxTpsCents = 0
  let taxTvqCents = 0
  if (isTaxable) {
    taxTpsCents = Math.round(afterDiscountCents * QC_TPS_RATE)
    taxTvqCents = Math.round(afterDiscountCents * QC_TVQ_RATE)
  }

  const totalCents = afterDiscountCents + taxTpsCents + taxTvqCents

  return {
    subtotalCents,
    discountCents,
    afterDiscountCents,
    taxTpsCents,
    taxTvqCents,
    totalCents,
  }
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format cents as a currency string (French-Canadian format).
 * @param cents - Amount in cents
 * @returns Formatted string like "130,00 $"
 */
export function formatCentsCurrency(cents: number): string {
  const dollars = cents / 100
  return dollars.toLocaleString('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  })
}

/**
 * Format cents as a simple decimal string.
 * @param cents - Amount in cents
 * @returns Formatted string like "130.00"
 */
export function formatCentsDecimal(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Parse a currency input string to cents.
 * Handles both "." and "," as decimal separators.
 * @param input - String like "130.00" or "130,50"
 * @returns Amount in cents
 */
export function parseCurrencyToCents(input: string): number {
  // Replace comma with period for parsing
  const normalized = input.replace(',', '.').replace(/[^0-9.]/g, '')
  const parsed = parseFloat(normalized)
  if (isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}

/**
 * Format minutes as hours and minutes.
 * @param minutes - Duration in minutes
 * @returns Formatted string like "1h 30min" or "45 min"
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (mins === 0) {
    return `${hours}h`
  }
  return `${hours}h ${mins}min`
}

/**
 * Calculate hourly equivalent from minute-based billing.
 * @param totalCents - Total amount in cents
 * @param minutes - Duration in minutes
 * @returns Hourly rate in cents
 */
export function calculateHourlyEquivalent(totalCents: number, minutes: number): number {
  if (minutes === 0) return 0
  return Math.round((totalCents / minutes) * 60)
}
