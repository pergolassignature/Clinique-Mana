// src/contracts/constants/pricing-margin.ts
// Clinic margin and professional portion calculations

/**
 * Clinic margin percentages by service type
 * These are the percentages retained by the clinic from client payments
 */
export const CLINIC_MARGINS = {
  // Standard consultation services
  consultation: {
    min: 25,
    max: 30,
  },
  // Workshops and conferences
  ateliersConferences: {
    min: 25,
    max: 25,
  },
  // Late cancellation / no-show
  annulationTardive: {
    min: 30,
    max: 30,
  },
  // Other fees (reports, external communications)
  autresFrais: {
    min: 15,
    max: 15,
  },
} as const

/**
 * Default margin range for standard consultation services
 * Used when calculating professional's portion on Annexe A
 */
export const DEFAULT_MARGIN = {
  min: 25, // Minimum clinic takes
  max: 30, // Maximum clinic takes
}

/**
 * Calculate the professional's portion range from the client price
 * @param clientPriceCents - The price charged to the client in cents
 * @param marginMin - Minimum margin percentage (default 25%)
 * @param marginMax - Maximum margin percentage (default 30%)
 * @returns Object with min and max professional portion in cents
 */
export function calculateProfessionalPortion(
  clientPriceCents: number,
  marginMin: number = DEFAULT_MARGIN.min,
  marginMax: number = DEFAULT_MARGIN.max
): { min: number; max: number } {
  // Professional gets (100 - margin)% of the client price
  // Higher margin = lower professional portion (hence min/max swap)
  const portionMax = Math.round(clientPriceCents * (1 - marginMin / 100))
  const portionMin = Math.round(clientPriceCents * (1 - marginMax / 100))

  return {
    min: portionMin,
    max: portionMax,
  }
}

/**
 * Format a price range for display in Annexe A
 * Example: formatPriceRange(8500, 9000) => "$85 à $90"
 * @param minCents - Minimum price in cents
 * @param maxCents - Maximum price in cents
 * @returns Formatted string like "$85 à $90"
 */
export function formatPriceRange(minCents: number, maxCents: number): string {
  const minDollars = Math.round(minCents / 100)
  const maxDollars = Math.round(maxCents / 100)

  if (minDollars === maxDollars) {
    return `$${minDollars}`
  }

  return `$${minDollars} à $${maxDollars}`
}

/**
 * Format a single price for display
 * @param priceCents - Price in cents
 * @returns Formatted string like "$ 120"
 */
export function formatPrice(priceCents: number): string {
  return `$ ${Math.round(priceCents / 100)}`
}

/**
 * Format price with professional portion in parentheses
 * Example: "$ 120\n($85 à $90)"
 * @param clientPriceCents - Client price in cents
 * @param marginMin - Minimum margin percentage
 * @param marginMax - Maximum margin percentage
 * @returns Formatted string with professional portion
 */
export function formatPriceWithPortion(
  clientPriceCents: number,
  marginMin: number = DEFAULT_MARGIN.min,
  marginMax: number = DEFAULT_MARGIN.max
): { clientPrice: string; professionalPortion: string } {
  const portion = calculateProfessionalPortion(clientPriceCents, marginMin, marginMax)

  return {
    clientPrice: formatPrice(clientPriceCents),
    professionalPortion: `(${formatPriceRange(portion.min, portion.max)})`,
  }
}

/**
 * Bonification rates per 50 appointments completed
 * As per contract section 3.5
 */
export const BONIFICATION_RATES = {
  per50Minutes: 0.5, // $0.50 per 50-minute session
  per30Minutes: 0.25, // $0.25 per 30-minute session
  maxBonificationPercent: 25, // Maximum 25% bonification cap
  appointmentThreshold: 50, // Per 50 appointments completed
}
