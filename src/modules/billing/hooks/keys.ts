/**
 * Facturation's query keys. Every write invalidates `all` (an invoice, its dossier's panel and the
 * lists move together; one clinic's invoices are few at a time).
 */
export const billingKeys = {
  all: ['billing'] as const,
  invoices: (status: string | null) => [...billingKeys.all, 'invoices', status] as const,
  invoice: (id: string) => [...billingKeys.all, 'invoice', id] as const,
  client: (clientId: string) => [...billingKeys.all, 'client', clientId] as const,
  names: () => [...billingKeys.all, 'names'] as const,
  sequence: (year: number) => [...billingKeys.all, 'sequence', year] as const,
}
