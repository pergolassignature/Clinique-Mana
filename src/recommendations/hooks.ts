// src/recommendations/hooks.ts
// React Query hooks for the Professional Recommendation System.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  DemandeRecommendation,
  GenerateRecommendationsResult,
} from './types'
import * as api from './api'
import type { GenerateRecommendationsOptions } from './api'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const recommendationKeys = {
  all: ['recommendations'] as const,
  lists: () => [...recommendationKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...recommendationKeys.lists(), filters] as const,
  details: () => [...recommendationKeys.all, 'detail'] as const,
  detail: (demandeId: string) => [...recommendationKeys.details(), demandeId] as const,
}

// =============================================================================
// MAIN HOOK
// =============================================================================

export interface UseDemandeRecommendationsResult {
  /** Current recommendations data, or null if none exist */
  data: DemandeRecommendation | null
  /** Loading state for fetching recommendations */
  isLoading: boolean
  /** Error from fetching recommendations */
  error: Error | null
  /** Refetch recommendations from database */
  refetch: () => Promise<void>
  /** Generate new recommendations */
  generate: (options?: GenerateRecommendationsOptions) => Promise<GenerateRecommendationsResult>
  /** Whether generation is in progress */
  isGenerating: boolean
  /** Error from generating recommendations */
  generateError: Error | null
}

/**
 * Main hook for working with demande recommendations.
 *
 * Provides:
 * - Fetching existing recommendations
 * - Generating new recommendations
 * - Loading and error states
 *
 * @param demandeId - The demande display ID (e.g., 'DEM-2026-0042'), or undefined to disable
 * @returns Hook result with data, loading states, and actions
 *
 * @example
 * ```tsx
 * const {
 *   data,
 *   isLoading,
 *   generate,
 *   isGenerating,
 * } = useDemandeRecommendations('DEM-2026-0042')
 *
 * if (isLoading) return <Spinner />
 * if (!data) return <Button onClick={() => generate()}>Generate</Button>
 * return <RecommendationsList recommendations={data.recommendations} />
 * ```
 */
export function useDemandeRecommendations(
  demandeId: string | undefined
): UseDemandeRecommendationsResult {
  const queryClient = useQueryClient()

  // Query for existing recommendations
  const query = useQuery({
    queryKey: recommendationKeys.detail(demandeId!),
    queryFn: () => api.fetchRecommendations(demandeId!),
    enabled: !!demandeId,
  })

  // Mutation for generating recommendations
  const generateMutation = useMutation({
    mutationFn: (options?: GenerateRecommendationsOptions) => {
      if (!demandeId) {
        return Promise.reject(new Error('No demande ID provided'))
      }
      return api.generateRecommendations(demandeId, {
        ...options,
        forceRegenerate: options?.forceRegenerate ?? true,
      })
    },
    onSuccess: () => {
      // Invalidate the query to refetch updated data
      if (demandeId) {
        queryClient.invalidateQueries({
          queryKey: recommendationKeys.detail(demandeId),
        })
      }

      // Also invalidate list queries if they exist
      queryClient.invalidateQueries({
        queryKey: recommendationKeys.lists(),
      })
    },
  })

  // Refetch function
  const refetch = async () => {
    if (demandeId) {
      await queryClient.invalidateQueries({
        queryKey: recommendationKeys.detail(demandeId),
      })
    }
  }

  // Generate function
  const generate = async (
    options?: GenerateRecommendationsOptions
  ): Promise<GenerateRecommendationsResult> => {
    return generateMutation.mutateAsync(options)
  }

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch,
    generate,
    isGenerating: generateMutation.isPending,
    generateError: generateMutation.error,
  }
}

// =============================================================================
// ADDITIONAL HOOKS
// =============================================================================

/**
 * Hook for fetching recommendations without the generate functionality.
 * Useful for read-only views.
 *
 * @param demandeId - The demande display ID, or undefined to disable
 */
export function useRecommendations(demandeId: string | undefined) {
  return useQuery({
    queryKey: recommendationKeys.detail(demandeId!),
    queryFn: () => api.fetchRecommendations(demandeId!),
    enabled: !!demandeId,
  })
}

/**
 * Hook for generating recommendations.
 * Returns a mutation that can be triggered on demand.
 *
 * @example
 * ```tsx
 * const generateMutation = useGenerateRecommendations()
 *
 * const handleGenerate = async () => {
 *   const result = await generateMutation.mutateAsync({
 *     demandeId: 'DEM-2026-0042',
 *     options: { forceRegenerate: true },
 *   })
 *   if (result.success) {
 *     console.log('Generated:', result.recommendations.length)
 *   }
 * }
 * ```
 */
export function useGenerateRecommendations() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      demandeId,
      options,
    }: {
      demandeId: string
      options?: GenerateRecommendationsOptions
    }) => api.generateRecommendations(demandeId, options),
    onSuccess: (_result, variables) => {
      // Invalidate the specific demande's recommendations
      queryClient.invalidateQueries({
        queryKey: recommendationKeys.detail(variables.demandeId),
      })
    },
  })
}

/**
 * Hook for logging recommendation views.
 * Automatically logs when the component mounts with valid data.
 *
 * @param recommendationId - UUID of the recommendation, or undefined to skip
 */
export function useLogRecommendationView(recommendationId: string | undefined) {
  return useQuery({
    queryKey: ['recommendationView', recommendationId],
    queryFn: async () => {
      if (recommendationId) {
        await api.logRecommendationView(recommendationId)
      }
      return { logged: true }
    },
    enabled: !!recommendationId,
    // Only log once per session
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * Hook for manually logging a recommendation view.
 * Useful when you want to log on a specific action (e.g., expanding details).
 */
export function useLogRecommendationViewMutation() {
  return useMutation({
    mutationFn: (recommendationId: string) =>
      api.logRecommendationView(recommendationId),
  })
}
