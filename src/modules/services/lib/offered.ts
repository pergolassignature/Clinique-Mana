import type { PriceSource, TaxRule } from './constants'

/** A service of the published catalogue (`services_catalog`), as « Services offerts » reads it. */
export interface CatalogueService {
  id: string
  code: number
  name: string
  durationMinutes: number
  bufferAfterMinutes: number
  forTwo: boolean
  priceSource: PriceSource
  taxRule: TaxRule
  titleIds: readonly string[]
  /** The professionals who do not offer it (R-83), as the caller reads them. */
  excludedProfessionalIds: readonly string[]
}

/** The price of a service for a title today (`list_service_prices`): `titleId` null for a price that does not depend on it. */
export interface TitlePrice {
  serviceId: string
  titleId: string | null
  priceCents: number | null
  source: PriceSource
}

export interface OfferedService extends CatalogueService {
  /** Her price today: by her primary title, else another of her titles, else the title-free price; null « À confirmer » or typed on the invoice. */
  priceCents: number | null
  /** False when she does not offer it though her title does (R-83: the clinic's list per professional). */
  offered: boolean
}

/**
 * « Services offerts » (L26, R-83): the active services one of her titles allows (a service
 * offered by no title is the clinic's, never listed here), by code, each with her price today and
 * whether she offers it. Pure: the catalogue, her titles and the prices come from the caller.
 */
export function offeredServices(
  catalogue: readonly CatalogueService[],
  titles: { professionalId: string; primaryTitleId: string | null; titleIds: readonly string[] },
  prices: readonly TitlePrice[],
): OfferedService[] {
  const order = [titles.primaryTitleId, ...titles.titleIds.filter((id) => id !== titles.primaryTitleId)].filter((id): id is string => id !== null)
  return catalogue
    .filter((s) => s.titleIds.some((id) => titles.titleIds.includes(id)))
    .map((s) => {
      const own = prices.filter((p) => p.serviceId === s.id)
      const byTitle = order.map((id) => own.find((p) => p.titleId === id)).find((p) => p !== undefined)
      const price = byTitle ?? own.find((p) => p.titleId === null)
      return { ...s, priceCents: price?.priceCents ?? null, offered: !s.excludedProfessionalIds.includes(titles.professionalId) }
    })
    .sort((a, b) => a.code - b.code)
}
