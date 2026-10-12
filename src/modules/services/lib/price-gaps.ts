import type { ProfessionTitle, Service, ServicePrice } from '../api/parse'
import type { GridDuration } from './constants'

/**
 * The « rapport d'écarts » (plan §5.4): the retention grids' client prices against what
 * GOrendezvous charged in 2026, per profession and duration (visite §18: prices per profession,
 * identical across the professionals of a profession). Observed figures in cents, by title key;
 * psychologie has no couple service (no 60 min figure). Research data, not clinic settings: a
 * change in GOrendezvous never reaches this file after the cutover.
 */
export const GORENDEZVOUS_OBSERVED_CENTS: Readonly<Record<string, Partial<Record<GridDuration, number>>>> = {
  travailleur_social: { 30: 8500, 50: 12000, 60: 15000 },
  psychoeducateur: { 30: 10000, 50: 14000, 60: 16500 },
  sexologue: { 30: 11000, 50: 15000, 60: 17500 },
  psychotherapeute: { 30: 12000, 50: 16000, 60: 18500 },
  psychologue: { 30: 13000, 50: 17500 },
}

/** The catalogue's reference service for each grid column (the individual 30 / 50 min sessions, the couple 60 min). */
export const REFERENCE_CODES: Readonly<Record<GridDuration, number>> = { 30: 10130, 50: 10150, 60: 20160 }

export interface PriceGap {
  title: ProfessionTitle
  duration: GridDuration
  /** The grid's price today, null when the title has no grid in force (« À confirmer »). */
  gridCents: number | null
  observedCents: number
}

/**
 * The gaps: every (title, duration) GOrendezvous priced whose grid price today differs (or is
 * missing), in the titles' order then 30 / 50 / 60. Titles the clinic no longer has are skipped.
 */
export function priceGaps(titles: readonly ProfessionTitle[], services: readonly Service[], prices: readonly ServicePrice[]): PriceGap[] {
  const gaps: PriceGap[] = []
  for (const title of titles) {
    const observed = GORENDEZVOUS_OBSERVED_CENTS[title.key]
    if (!observed) continue
    for (const duration of [30, 50, 60] as const) {
      const observedCents = observed[duration]
      if (observedCents === undefined) continue
      const service = services.find((s) => s.code === REFERENCE_CODES[duration] && s.isActive)
      if (!service) continue
      const price = prices.find((p) => p.serviceId === service.id && p.titleId === title.id)
      const gridCents = price?.priceCents ?? null
      if (gridCents !== observedCents) gaps.push({ title, duration, gridCents, observedCents })
    }
  }
  return gaps
}
