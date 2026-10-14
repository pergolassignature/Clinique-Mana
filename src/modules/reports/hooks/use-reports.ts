import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  fetchCancellations,
  fetchConsentsReport,
  fetchFollowUp,
  fetchRevenue,
  type CancellationFilters,
  type ConsentsFilters,
  type FollowUpFilters,
  type RevenueFilters,
} from '../api/reports'
import { fetchDemandesReport, type DemandesReportFilters } from '../api/demandes-report'
import { fetchIvacReport, fetchPayoutsReport, type IvacFilters, type PayoutsFilters } from '../api/rp2'
import { reportsKeys } from './keys'

// The previous answer stays on screen while a new filter loads (no flash of « Chargement »).
export function useRevenue(f: RevenueFilters, enabled = true) {
  return useQuery({ queryKey: reportsKeys.revenue(f), queryFn: () => fetchRevenue(f), placeholderData: keepPreviousData, enabled })
}

export function useCancellations(f: CancellationFilters, enabled = true) {
  return useQuery({ queryKey: reportsKeys.cancellations(f), queryFn: () => fetchCancellations(f), placeholderData: keepPreviousData, enabled })
}

export function useFollowUp(f: FollowUpFilters, enabled = true) {
  return useQuery({ queryKey: reportsKeys.followUp(f), queryFn: () => fetchFollowUp(f), placeholderData: keepPreviousData, enabled })
}

/** Rapports « Demandes » (D6): the whole page in one answer. */
export function useDemandesReport(f: DemandesReportFilters, enabled = true) {
  return useQuery({ queryKey: reportsKeys.demandes(f), queryFn: () => fetchDemandesReport(f), placeholderData: keepPreviousData, enabled })
}

export function useConsentsReport(f: ConsentsFilters, enabled = true) {
  return useQuery({ queryKey: reportsKeys.consents(f), queryFn: () => fetchConsentsReport(f), placeholderData: keepPreviousData, enabled })
}

/** Rapports « IVAC » (RP-7). */
export function useIvacReport(f: IvacFilters, enabled = true) {
  return useQuery({ queryKey: reportsKeys.ivac(f), queryFn: () => fetchIvacReport(f), placeholderData: keepPreviousData, enabled })
}

/** Rapports « Paie » (RP-8). */
export function usePayoutsReport(f: PayoutsFilters, enabled = true) {
  return useQuery({ queryKey: reportsKeys.payouts(f), queryFn: () => fetchPayoutsReport(f), placeholderData: keepPreviousData, enabled })
}
