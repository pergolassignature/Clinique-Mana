import { useQuery } from '@tanstack/react-query'
import type { ClientsListFilters, ClientsListSort, ClientListItem, ClientWithRelations } from './types'
import { MOCK_CLIENT_LIST_ITEMS, MOCK_PROFESSIONALS, getClientWithRelations } from './constants'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filters?: ClientsListFilters, sort?: ClientsListSort) =>
    [...clientKeys.lists(), { filters, sort }] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: string) => [...clientKeys.details(), id] as const,
}

// =============================================================================
// FILTER HELPERS
// =============================================================================

function filterClients(
  clients: ClientListItem[],
  filters?: ClientsListFilters,
  sort?: ClientsListSort
): ClientListItem[] {
  let result = [...clients]

  if (filters) {
    // Status filter
    if (filters.status) {
      result = result.filter(c => c.status === filters.status)
    }

    // Search filter (name, email, ID)
    if (filters.search) {
      const search = filters.search.toLowerCase()
      result = result.filter(c =>
        c.firstName.toLowerCase().includes(search) ||
        c.lastName.toLowerCase().includes(search) ||
        c.clientId.toLowerCase().includes(search) ||
        c.email?.toLowerCase().includes(search)
      )
    }

    // Tags filter
    if (filters.tags && filters.tags.length > 0) {
      result = result.filter(c =>
        filters.tags!.some(tag => c.tags.includes(tag))
      )
    }

    // Primary professional filter (for role-based filtering)
    if (filters.primaryProfessionalId) {
      result = result.filter(c => c.primaryProfessionalId === filters.primaryProfessionalId)
    }

    // Date range filter
    if (filters.dateRange) {
      const { from, to } = filters.dateRange
      result = result.filter(c => {
        if (!c.lastAppointmentDateTime) return false
        const date = new Date(c.lastAppointmentDateTime)
        return date >= new Date(from) && date <= new Date(to)
      })
    }
  }

  // Sort
  if (sort) {
    result.sort((a, b) => {
      let comparison = 0
      switch (sort.field) {
        case 'name':
          comparison = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
          break
        case 'clientId':
          comparison = a.clientId.localeCompare(b.clientId)
          break
        case 'birthday':
          comparison = (a.birthday || '').localeCompare(b.birthday || '')
          break
        case 'lastAppointment':
          comparison = (a.lastAppointmentDateTime || '').localeCompare(b.lastAppointmentDateTime || '')
          break
        case 'createdAt':
          // For list items, we don't have createdAt, so default to ID
          comparison = a.clientId.localeCompare(b.clientId)
          break
      }
      return sort.direction === 'desc' ? -comparison : comparison
    })
  }

  return result
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Fetch list of clients with optional filtering and sorting
 */
export function useClients(filters?: ClientsListFilters, sort?: ClientsListSort) {
  return useQuery({
    queryKey: clientKeys.list(filters, sort),
    queryFn: async () => {
      // Simulate API delay
      await new Promise(r => setTimeout(r, 300))

      // Filter and sort mock data
      return filterClients(MOCK_CLIENT_LIST_ITEMS, filters, sort)
    },
  })
}

/**
 * Fetch single client with all relations
 */
export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: clientKeys.detail(id!),
    queryFn: async (): Promise<ClientWithRelations | undefined> => {
      // Simulate API delay
      await new Promise(r => setTimeout(r, 200))

      if (!id) return undefined
      return getClientWithRelations(id)
    },
    enabled: !!id,
  })
}

/**
 * Get unique tags from all clients (for filter dropdown)
 */
export function useClientTags() {
  return useQuery({
    queryKey: [...clientKeys.all, 'tags'],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 100))

      // Extract unique tags from all clients
      const tags = new Set<string>()
      MOCK_CLIENT_LIST_ITEMS.forEach(client => {
        client.tags.forEach(tag => tags.add(tag))
      })
      return Array.from(tags).sort()
    },
  })
}

/**
 * Get list of professionals (for filter dropdown)
 */
export function useProfessionals() {
  return useQuery({
    queryKey: [...clientKeys.all, 'professionals'],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 100))
      return MOCK_PROFESSIONALS
    },
  })
}

// =============================================================================
// FUTURE MUTATION HOOKS (placeholders)
// =============================================================================

// TODO: useCreateClient
// TODO: useUpdateClient
// TODO: useArchiveClient
// TODO: useDeleteClient
// TODO: useAddClientNote
// TODO: useAddClientConsent
