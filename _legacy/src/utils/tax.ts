// src/utils/tax.ts
// Quebec tax calculation utilities for pre-tax price storage model

// =============================================================================
// TAX RATES
// =============================================================================

/** TPS (GST) rate: 5% */
export const QC_TPS_RATE = 0.05

/** TVQ (QST) rate: 9.975% */
export const QC_TVQ_RATE = 0.09975

/** Combined TPS + TVQ rate: 14.975% */
export const QC_COMBINED_RATE = QC_TPS_RATE + QC_TVQ_RATE

// =============================================================================
// TAX CALCULATIONS
// =============================================================================

/**
 * Calculate tax amount from a pre-tax price.
 * @param preTaxCents - Price before tax in cents
 * @returns Tax amount in cents (TPS + TVQ combined)
 */
export function calculateTax(preTaxCents: number): number {
  return Math.round(preTaxCents * QC_COMBINED_RATE)
}

/**
 * Calculate TPS (GST) amount from a pre-tax price.
 * @param preTaxCents - Price before tax in cents
 * @returns TPS amount in cents
 */
export function calculateTps(preTaxCents: number): number {
  return Math.round(preTaxCents * QC_TPS_RATE)
}

/**
 * Calculate TVQ (QST) amount from a pre-tax price.
 * @param preTaxCents - Price before tax in cents
 * @returns TVQ amount in cents
 */
export function calculateTvq(preTaxCents: number): number {
  return Math.round(preTaxCents * QC_TVQ_RATE)
}

/**
 * Calculate total price (pre-tax + tax) from a pre-tax price.
 * @param preTaxCents - Price before tax in cents
 * @returns Total price including tax in cents
 */
export function calculateTotal(preTaxCents: number): number {
  return preTaxCents + calculateTax(preTaxCents)
}

/**
 * Extract pre-tax price from a tax-inclusive total.
 * Used when admin enters a final price and we need to store the pre-tax amount.
 * @param totalCents - Total price including tax in cents
 * @returns Pre-tax price in cents
 */
export function extractPreTax(totalCents: number): number {
  return Math.round(totalCents / (1 + QC_COMBINED_RATE))
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format a price in cents as a dollar string.
 * @param cents - Price in cents
 * @returns Formatted string like "130.00"
 */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Format a price with tax breakdown for display.
 * @param preTaxCents - Price before tax in cents
 * @param isTaxable - Whether the service is taxable
 * @returns Formatted string:
 *   - Taxable: "113.07 $ + 16.93 $ taxes = 130.00 $"
 *   - Exempt: "160.00 $"
 */
export function formatPriceWithTax(
  preTaxCents: number,
  isTaxable: boolean
): string {
  if (!isTaxable) {
    return `${formatCents(preTaxCents)} $`
  }
  const taxCents = calculateTax(preTaxCents)
  const totalCents = preTaxCents + taxCents
  return `${formatCents(preTaxCents)} $ + ${formatCents(taxCents)} $ taxes = ${formatCents(totalCents)} $`
}

/**
 * Format a price for compact display (total only).
 * @param preTaxCents - Price before tax in cents
 * @param isTaxable - Whether the service is taxable
 * @returns Formatted string with total: "130.00 $" (shows final price customer pays)
 */
export function formatPriceTotal(
  preTaxCents: number,
  isTaxable: boolean
): string {
  const displayCents = isTaxable ? calculateTotal(preTaxCents) : preTaxCents
  return `${formatCents(displayCents)} $`
}

// =============================================================================
// INVOICE HELPERS (for future invoicing module)
// =============================================================================

export interface TaxBreakdown {
  preTaxCents: number
  tpsCents: number
  tvqCents: number
  totalTaxCents: number
  totalCents: number
}

/**
 * Get full tax breakdown for invoicing.
 * @param preTaxCents - Price before tax in cents
 * @param isTaxable - Whether the service is taxable
 * @returns Complete breakdown with all amounts
 */
export function getTaxBreakdown(
  preTaxCents: number,
  isTaxable: boolean
): TaxBreakdown {
  if (!isTaxable) {
    return {
      preTaxCents,
      tpsCents: 0,
      tvqCents: 0,
      totalTaxCents: 0,
      totalCents: preTaxCents,
    }
  }

  const tpsCents = calculateTps(preTaxCents)
  const tvqCents = calculateTvq(preTaxCents)
  const totalTaxCents = tpsCents + tvqCents
  const totalCents = preTaxCents + totalTaxCents

  return {
    preTaxCents,
    tpsCents,
    tvqCents,
    totalTaxCents,
    totalCents,
  }
}
