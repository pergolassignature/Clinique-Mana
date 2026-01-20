// src/services-catalog/hooks.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchServices,
  fetchActiveServices,
  fetchServiceById,
  createService,
  updateService,
  archiveService,
  restoreService,
  fetchProfessionCategories,
  fetchProfessionTitles,
  fetchAllServicePrices,
} from './api'
import type { ServiceFormData } from './types'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const serviceKeys = {
  all: ['services'] as const,
  lists: () => [...serviceKeys.all, 'list'] as const,
  list: (filters?: { active?: boolean }) => [...serviceKeys.lists(), filters] as const,
  details: () => [...serviceKeys.all, 'detail'] as const,
  detail: (id: string) => [...serviceKeys.details(), id] as const,
  prices: () => [...serviceKeys.all, 'prices'] as const,
}

export const professionKeys = {
  all: ['professions'] as const,
  categories: () => [...professionKeys.all, 'categories'] as const,
  titles: () => [...professionKeys.all, 'titles'] as const,
}

// =============================================================================
// SERVICES QUERIES
// =============================================================================

export function useServices() {
  return useQuery({
    queryKey: serviceKeys.list(),
    queryFn: fetchServices,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

export function useActiveServices() {
  return useQuery({
    queryKey: serviceKeys.list({ active: true }),
    queryFn: fetchActiveServices,
    staleTime: 1000 * 60 * 5,
  })
}

export function useService(id: string) {
  return useQuery({
    queryKey: serviceKeys.detail(id),
    queryFn: () => fetchServiceById(id),
    enabled: !!id,
  })
}

export function useServicePrices() {
  return useQuery({
    queryKey: serviceKeys.prices(),
    queryFn: fetchAllServicePrices,
    staleTime: 1000 * 60 * 5,
  })
}

// =============================================================================
// PROFESSION QUERIES
// =============================================================================

export function useProfessionCategories() {
  return useQuery({
    queryKey: professionKeys.categories(),
    queryFn: fetchProfessionCategories,
    staleTime: 1000 * 60 * 30, // 30 minutes - rarely changes
  })
}

export function useProfessionTitles() {
  return useQuery({
    queryKey: professionKeys.titles(),
    queryFn: fetchProfessionTitles,
    staleTime: 1000 * 60 * 30,
  })
}

// =============================================================================
// SERVICES MUTATIONS
// =============================================================================

export function useCreateService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ServiceFormData) => createService(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.lists() })
    },
  })
}

export function useUpdateService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ServiceFormData> }) =>
      updateService(id, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: serviceKeys.detail(data.id) })
    },
  })
}

export function useArchiveService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => archiveService(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: serviceKeys.detail(data.id) })
    },
  })
}

export function useRestoreService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => restoreService(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: serviceKeys.detail(data.id) })
    },
  })
}
