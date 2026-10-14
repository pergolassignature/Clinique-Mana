import type { DemandesReportFilters } from '../api/demandes-report'
import type { CancellationFilters, ConsentsFilters, FollowUpFilters, RevenueFilters } from '../api/reports'
import type { IvacFilters, PayoutsFilters } from '../api/rp2'

/** Rapports' query keys: read-only reports, one entry per set of filters. */
export const reportsKeys = {
  all: ['reports'] as const,
  revenue: (f: RevenueFilters) => [...reportsKeys.all, 'revenue', f] as const,
  cancellations: (f: CancellationFilters) => [...reportsKeys.all, 'cancellations', f] as const,
  followUp: (f: FollowUpFilters) => [...reportsKeys.all, 'follow-up', f] as const,
  demandes: (f: DemandesReportFilters) => [...reportsKeys.all, 'demandes', f] as const,
  consents: (f: ConsentsFilters) => [...reportsKeys.all, 'consents', f] as const,
  ivac: (f: IvacFilters) => [...reportsKeys.all, 'ivac', f] as const,
  payouts: (f: PayoutsFilters) => [...reportsKeys.all, 'payouts', f] as const,
}
