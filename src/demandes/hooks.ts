import { useQuery } from '@tanstack/react-query'
import type { DemandesListFilters, DemandesListSort, DemandeListItem } from './types'
import { MOCK_DEMANDE_LIST_ITEMS, getStatusCounts } from './constants'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const demandeKeys = {
  all: ['demandes'] as const,
  lists: () => [...demandeKeys.all, 'list'] as const,
  list: (filters?: DemandesListFilters, sort?: DemandesListSort) =>
    [...demandeKeys.lists(), { filters, sort }] as const,
  details: () => [...demandeKeys.all, 'detail'] as const,
  detail: (id: string) => [...demandeKeys.details(), id] as const,
  statusCounts: () => [...demandeKeys.all, 'statusCounts'] as const,
}

// =============================================================================
// FILTER HELPERS
// =============================================================================

function filterDemandes(
  demandes: DemandeListItem[],
  filters?: DemandesListFilters,
  sort?: DemandesListSort
): DemandeListItem[] {
  let result = [...demandes]

  if (filters) {
    // Status filter
    if (filters.status) {
      result = result.filter(d => d.status === filters.status)
    }

    // Search filter (client name, ID)
    if (filters.search) {
      const search = filters.search.toLowerCase()
      result = result.filter(
        d =>
          d.primaryClientName?.toLowerCase().includes(search) ||
          d.id.toLowerCase().includes(search)
      )
    }
  }

  // Sort (default: createdAt desc)
  if (sort) {
    result.sort((a, b) => {
      let comparison = 0
      switch (sort.field) {
        case 'id':
          comparison = a.id.localeCompare(b.id)
          break
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'status':
          comparison = a.status.localeCompare(b.status)
          break
        case 'urgency': {
          const urgencyOrder: Record<string, number> = { high: 0, moderate: 1, low: 2 }
          const aOrder = a.urgency ? (urgencyOrder[a.urgency] ?? 3) : 3
          const bOrder = b.urgency ? (urgencyOrder[b.urgency] ?? 3) : 3
          comparison = aOrder - bOrder
          break
        }
      }
      return sort.direction === 'desc' ? -comparison : comparison
    })
  } else {
    // Default sort: newest first
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  return result
}

// =============================================================================
// HOOKS
// =============================================================================

export function useDemandes(filters?: DemandesListFilters, sort?: DemandesListSort) {
  return useQuery({
    queryKey: demandeKeys.list(filters, sort),
    queryFn: async () => {
      // Simulate API delay
      await new Promise(r => setTimeout(r, 300))
      return filterDemandes(MOCK_DEMANDE_LIST_ITEMS, filters, sort)
    },
  })
}

export function useDemandeStatusCounts() {
  return useQuery({
    queryKey: demandeKeys.statusCounts(),
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 100))
      return getStatusCounts()
    },
  })
}
