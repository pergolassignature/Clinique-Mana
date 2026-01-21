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
  fetchCategoryPrices,
  upsertCategoryPrices,
  upsertServiceBasePrice,
  fetchTaxRates,
  fetchServiceTaxRules,
  fetchAllServiceTaxProfiles,
  setServiceTaxProfile,
  updateCategoryTaxIncluded,
  fetchProfessionCategoryRates,
  updateProfessionCategoryRate,
} from './api'
import type { CategoryPriceInput } from './api'
import type { ServiceFormData, ServiceTaxProfile } from './types'

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
  categoryPrices: () => [...serviceKeys.all, 'category-prices'] as const,
  taxProfiles: () => [...serviceKeys.all, 'tax-profiles'] as const,
  taxRules: (serviceId: string) => [...serviceKeys.detail(serviceId), 'tax-rules'] as const,
}

export const taxKeys = {
  all: ['tax'] as const,
  rates: () => [...taxKeys.all, 'rates'] as const,
}

export const professionKeys = {
  all: ['professions'] as const,
  categories: () => [...professionKeys.all, 'categories'] as const,
  titles: () => [...professionKeys.all, 'titles'] as const,
  rates: () => [...professionKeys.all, 'rates'] as const,
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

export function useCategoryPrices() {
  return useQuery({
    queryKey: serviceKeys.categoryPrices(),
    queryFn: fetchCategoryPrices,
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

export function useUpdateCategoryTaxIncluded() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      categoryKey,
      taxIncluded,
    }: {
      categoryKey: string
      taxIncluded: boolean
    }) => updateCategoryTaxIncluded(categoryKey, taxIncluded),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: professionKeys.categories() })
    },
  })
}

/**
 * Fetch all profession category hourly rates.
 */
export function useProfessionCategoryRates() {
  return useQuery({
    queryKey: professionKeys.rates(),
    queryFn: fetchProfessionCategoryRates,
    staleTime: 1000 * 60 * 10, // 10 minutes
  })
}

/**
 * Update hourly rate for a profession category.
 */
export function useUpdateProfessionCategoryRate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      categoryKey,
      hourlyRateCents,
    }: {
      categoryKey: string
      hourlyRateCents: number
    }) => updateProfessionCategoryRate(categoryKey, hourlyRateCents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: professionKeys.rates() })
    },
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

// =============================================================================
// TAX QUERIES & MUTATIONS
// =============================================================================

export function useTaxRates() {
  return useQuery({
    queryKey: taxKeys.rates(),
    queryFn: fetchTaxRates,
    staleTime: 1000 * 60 * 30, // 30 minutes - tax rates rarely change
  })
}

export function useServiceTaxRules(serviceId: string | undefined) {
  return useQuery({
    queryKey: serviceKeys.taxRules(serviceId!),
    queryFn: () => fetchServiceTaxRules(serviceId!),
    enabled: !!serviceId,
  })
}

export function useAllServiceTaxProfiles() {
  return useQuery({
    queryKey: serviceKeys.taxProfiles(),
    queryFn: fetchAllServiceTaxProfiles,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

export function useSetServiceTaxProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      serviceId,
      profile,
    }: {
      serviceId: string
      profile: ServiceTaxProfile
    }) => setServiceTaxProfile(serviceId, profile),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.taxRules(variables.serviceId) })
      queryClient.invalidateQueries({ queryKey: serviceKeys.taxProfiles() })
    },
  })
}

// =============================================================================
// CATEGORY PRICING MUTATIONS
// =============================================================================

export function useUpsertCategoryPrices() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      categoryKey,
      prices,
    }: {
      categoryKey: string
      prices: CategoryPriceInput[]
    }) => upsertCategoryPrices(categoryKey, prices),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.categoryPrices() })
      queryClient.invalidateQueries({ queryKey: serviceKeys.prices() })
    },
  })
}

export function useUpsertServiceBasePrice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ serviceId, priceCents }: { serviceId: string; priceCents: number | null }) =>
      upsertServiceBasePrice(serviceId, priceCents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.prices() })
    },
  })
}
