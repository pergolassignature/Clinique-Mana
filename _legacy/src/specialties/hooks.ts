// src/specialties/hooks.ts
// React Query hooks for the specialties module

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { CreateSpecialtyInput, UpdateSpecialtyInput } from './types'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const specialtyKeys = {
  all: ['specialties'] as const,
  list: (includeInactive?: boolean) => [...specialtyKeys.all, 'list', { includeInactive }] as const,
  byCategory: (includeInactive?: boolean) => [...specialtyKeys.all, 'by-category', { includeInactive }] as const,
  detail: (id: string) => [...specialtyKeys.all, 'detail', id] as const,
  usageCount: (id: string) => [...specialtyKeys.all, 'usage-count', id] as const,
}

// =============================================================================
// QUERIES
// =============================================================================

export interface UseSpecialtiesOptions {
  includeInactive?: boolean
}

/**
 * Fetch all specialties
 */
export function useSpecialties(options: UseSpecialtiesOptions = {}) {
  const { includeInactive = false } = options

  return useQuery({
    queryKey: specialtyKeys.list(includeInactive),
    queryFn: () => includeInactive ? api.fetchAllSpecialties() : api.fetchActiveSpecialties(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Fetch specialties grouped by category
 */
export function useSpecialtiesByCategory(options: UseSpecialtiesOptions = {}) {
  const { includeInactive = false } = options

  return useQuery({
    queryKey: specialtyKeys.byCategory(includeInactive),
    queryFn: () => api.fetchSpecialtiesByCategory(includeInactive),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Count professionals using a specialty (for archive warning)
 */
export function useSpecialtyUsageCount(specialtyId: string | undefined) {
  return useQuery({
    queryKey: specialtyKeys.usageCount(specialtyId!),
    queryFn: () => api.countProfessionalsUsingSpecialty(specialtyId!),
    enabled: !!specialtyId,
  })
}

// =============================================================================
// MUTATIONS
// =============================================================================

export interface MutationResult {
  success: boolean
  error?: Error
}

/**
 * Mutations for specialty management
 */
export function useSpecialtyMutations() {
  const queryClient = useQueryClient()

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: specialtyKeys.all })
  }

  // Create specialty
  const createMutation = useMutation({
    mutationFn: (input: CreateSpecialtyInput) => api.createSpecialty(input),
    onSuccess: invalidateAll,
  })

  // Update specialty
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSpecialtyInput }) =>
      api.updateSpecialty(id, input),
    onSuccess: invalidateAll,
  })

  // Archive specialty
  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.archiveSpecialty(id),
    onSuccess: invalidateAll,
  })

  // Unarchive specialty
  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => api.unarchiveSpecialty(id),
    onSuccess: invalidateAll,
  })

  return {
    // Create
    createSpecialty: async (input: CreateSpecialtyInput): Promise<MutationResult> => {
      try {
        await createMutation.mutateAsync(input)
        return { success: true }
      } catch (error) {
        return { success: false, error: error as Error }
      }
    },

    // Update
    updateSpecialty: async (id: string, input: UpdateSpecialtyInput): Promise<MutationResult> => {
      try {
        await updateMutation.mutateAsync({ id, input })
        return { success: true }
      } catch (error) {
        return { success: false, error: error as Error }
      }
    },

    // Archive
    archiveSpecialty: async (id: string): Promise<MutationResult> => {
      try {
        await archiveMutation.mutateAsync(id)
        return { success: true }
      } catch (error) {
        return { success: false, error: error as Error }
      }
    },

    // Unarchive
    unarchiveSpecialty: async (id: string): Promise<MutationResult> => {
      try {
        await unarchiveMutation.mutateAsync(id)
        return { success: true }
      } catch (error) {
        return { success: false, error: error as Error }
      }
    },

    // Validate code uniqueness
    validateCode: async (code: string, excludeId?: string): Promise<boolean> => {
      return api.isCodeUnique(code, excludeId)
    },
  }
}
