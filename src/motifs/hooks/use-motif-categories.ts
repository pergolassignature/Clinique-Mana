// src/motifs/hooks/use-motif-categories.ts
// React Query hooks for motif categories

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/shared/hooks/use-toast'
import {
  fetchAllMotifCategories,
  fetchActiveMotifCategories,
  createMotifCategory,
  updateMotifCategory,
  archiveMotifCategory,
  unarchiveMotifCategory,
  countMotifsInCategory,
} from '../api'
import type { MotifCategoryInput } from '../types'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const motifCategoryKeys = {
  all: ['motif-categories'] as const,
  list: (includeInactive: boolean) => [...motifCategoryKeys.all, 'list', { includeInactive }] as const,
  detail: (id: string) => [...motifCategoryKeys.all, 'detail', id] as const,
  motifCount: (id: string) => [...motifCategoryKeys.all, 'motifCount', id] as const,
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Fetch motif categories
 */
export function useMotifCategories(options: { includeInactive?: boolean } = {}) {
  const { includeInactive = false } = options

  return useQuery({
    queryKey: motifCategoryKeys.list(includeInactive),
    queryFn: includeInactive ? fetchAllMotifCategories : fetchActiveMotifCategories,
  })
}

/**
 * Count motifs in a category (for archive warning)
 */
export function useMotifCountInCategory(categoryId: string) {
  return useQuery({
    queryKey: motifCategoryKeys.motifCount(categoryId),
    queryFn: () => countMotifsInCategory(categoryId),
    enabled: !!categoryId,
  })
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new motif category
 */
export function useCreateMotifCategory() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (input: MotifCategoryInput) => createMotifCategory(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: motifCategoryKeys.all })
      toast({ title: 'Catégorie créée' })
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        variant: 'error',
      })
    },
  })
}

/**
 * Update an existing motif category
 */
export function useUpdateMotifCategory() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<MotifCategoryInput> }) =>
      updateMotifCategory(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: motifCategoryKeys.all })
      toast({ title: 'Catégorie mise à jour' })
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        variant: 'error',
      })
    },
  })
}

/**
 * Archive a motif category (soft delete)
 */
export function useArchiveMotifCategory() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: archiveMotifCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: motifCategoryKeys.all })
      toast({ title: 'Catégorie archivée' })
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        variant: 'error',
      })
    },
  })
}

/**
 * Restore an archived motif category
 */
export function useUnarchiveMotifCategory() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: unarchiveMotifCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: motifCategoryKeys.all })
      toast({ title: 'Catégorie restaurée' })
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        variant: 'error',
      })
    },
  })
}
