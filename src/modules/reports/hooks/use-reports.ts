import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  fetchCancellations,
  fetchFollowUp,
  fetchRevenue,
  type CancellationFilters,
  type FollowUpFilters,
  type RevenueFilters,
} from '../api/reports'
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
