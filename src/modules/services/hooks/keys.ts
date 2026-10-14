/**
 * React Query keys of the module. One root: every write (a service saved, archived or restored, its
 * titles, a variant, a policy) invalidates `serviceKeys.all`, so the settings bundle and the price
 * table refetch together (the prices follow the catalogue and the variants). A later module that
 * only reads the catalogue keys its own queries.
 */
export const serviceKeys = {
  all: ['services'] as const,
  /** The settings section's bundle: families, services, titles, variants, policies. */
  settings: () => [...serviceKeys.all, 'settings'] as const,
  /** Every price of the active catalogue on a date (`list_service_prices`). */
  prices: (on: string) => [...serviceKeys.all, 'prices', on] as const,
  /** A professional's « Services offerts » on a date (L26). */
  offered: (professionalId: string, on: string) => [...serviceKeys.all, 'offered', professionalId, on] as const,
  /** The GST and QST in force on a date (core's `tax_rate_on`), for « Prix »'s after-tax preview. */
  taxRates: (on: string) => [...serviceKeys.all, 'tax-rates', on] as const,
}
