import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import type { DemandesListFilters, DemandesListSort, DemandeListItem, DemandeStatus } from './types'
import * as api from './api'
import type { CreateDemandeInput, UpdateDemandeInput } from './api'

// Motif labels for display
const MOTIF_LABELS: Record<string, string> = {
  anxiety: 'Anxiété',
  stress: 'Stress',
  burnout: 'Épuisement',
  relationships: 'Relations',
  emotions: 'Émotions',
  parenting: 'Soutien parental',
  selfExploration: 'Questionnement',
  lifeTransition: 'Transition',
  workSupport: 'Travail',
  grief: 'Deuil',
  selfEsteem: 'Estime de soi',
  other: 'Autre',
}

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
// HOOKS
// =============================================================================

export function useDemandes(filters?: DemandesListFilters, sort?: DemandesListSort) {
  return useQuery({
    queryKey: demandeKeys.list(filters, sort),
    queryFn: async (): Promise<DemandeListItem[]> => {
      let query = supabase
        .from('demandes')
        .select(`
          id,
          demande_id,
          status,
          demand_type,
          urgency,
          selected_motifs,
          schedule_preferences,
          created_at,
          demande_participants (
            id,
            role,
            clients:client_id (
              id,
              first_name,
              last_name
            )
          )
        `)

      // Status filter
      if (filters?.status) {
        query = query.eq('status', filters.status)
      }

      // Search filter (by demande_id or participant name)
      if (filters?.search) {
        const search = `%${filters.search}%`
        query = query.ilike('demande_id', search)
      }

      // Sorting
      if (sort) {
        const ascending = sort.direction === 'asc'
        switch (sort.field) {
          case 'id':
            query = query.order('demande_id', { ascending })
            break
          case 'createdAt':
            query = query.order('created_at', { ascending })
            break
          case 'status':
            query = query.order('status', { ascending })
            break
          case 'urgency':
            query = query.order('urgency', { ascending, nullsFirst: false })
            break
        }
      } else {
        // Default: newest first
        query = query.order('created_at', { ascending: false })
      }

      const { data, error } = await query

      if (error) throw error

      // Transform to DemandeListItem format
      return (data || []).map((row): DemandeListItem => {
        const participants = row.demande_participants as unknown as Array<{
          id: string
          role: string
          clients: { id: string; first_name: string; last_name: string } | null
        }> || []

        const primaryParticipant = participants.find(p => p.role === 'principal')
        const motifs = row.selected_motifs || []

        return {
          id: row.demande_id,
          status: row.status as DemandeStatus,
          demandType: row.demand_type,
          urgency: row.urgency,
          createdAt: row.created_at,
          primaryClientName: primaryParticipant?.clients
            ? `${primaryParticipant.clients.first_name} ${primaryParticipant.clients.last_name}`
            : null,
          participantCount: participants.length,
          motifLabels: motifs.slice(0, 2).map((m: string) => MOTIF_LABELS[m] || m),
          motifCount: motifs.length,
          schedulePreferences: (row.schedule_preferences as string[]) ?? [],
        }
      })
    },
  })
}

export function useDemandeStatusCounts() {
  return useQuery({
    queryKey: demandeKeys.statusCounts(),
    queryFn: async (): Promise<Record<DemandeStatus | 'all', number>> => {
      const { data, error } = await supabase
        .from('demandes')
        .select('status')

      if (error) throw error

      const counts: Record<DemandeStatus | 'all', number> = {
        toAnalyze: 0,
        assigned: 0,
        closed: 0,
        all: 0,
      }

      data?.forEach(row => {
        counts.all++
        const status = row.status as DemandeStatus
        if (status in counts) {
          counts[status]++
        }
      })

      return counts
    },
  })
}

// =============================================================================
// FETCH SINGLE DEMANDE
// =============================================================================

export function useDemande(demandeId: string | undefined) {
  return useQuery({
    queryKey: demandeKeys.detail(demandeId!),
    queryFn: () => api.fetchDemande(demandeId!),
    enabled: !!demandeId && demandeId !== 'nouvelle',
  })
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new demande
 */
export function useCreateDemande() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateDemandeInput) => api.createDemande(input),
    onSuccess: () => {
      // Invalidate all demande queries to refetch lists
      queryClient.invalidateQueries({ queryKey: demandeKeys.all })
    },
  })
}

/**
 * Update an existing demande
 */
export function useUpdateDemande() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ demandeId, updates }: { demandeId: string; updates: UpdateDemandeInput }) =>
      api.updateDemande(demandeId, updates),
    onSuccess: (data) => {
      // Invalidate specific demande query and lists
      queryClient.invalidateQueries({ queryKey: demandeKeys.detail(data.demandeId) })
      queryClient.invalidateQueries({ queryKey: demandeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: demandeKeys.statusCounts() })
    },
  })
}

/**
 * Assign a professional to a demande
 */
export function useAssignDemande() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ demandeId, professionalId, assignedBy }: {
      demandeId: string
      professionalId: string
      assignedBy: string
    }) => api.assignDemande(demandeId, { professionalId, assignedBy }),
    onSuccess: (data) => {
      // Invalidate specific demande query and lists
      queryClient.invalidateQueries({ queryKey: demandeKeys.detail(data.demandeId) })
      queryClient.invalidateQueries({ queryKey: demandeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: demandeKeys.statusCounts() })
    },
  })
}
