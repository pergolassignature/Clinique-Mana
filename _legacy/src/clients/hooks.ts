import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import type { ClientsListFilters, ClientsListSort, ClientListItem, ClientWithRelations, CreateClientInput } from './types'
import * as api from './api'
import type { CreateClientMinimalInput, UpdateClientInput } from './api'

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
  batch: (ids: string[]) => [...clientKeys.all, 'batch', ids.sort().join(',')] as const,
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
    queryFn: async (): Promise<ClientListItem[]> => {
      let query = supabase
        .from('clients')
        .select(`
          id,
          client_id,
          first_name,
          last_name,
          birthday,
          email,
          cell_phone,
          last_appointment_at,
          is_archived,
          tags,
          primary_professional_id,
          professionals:primary_professional_id (
            id,
            profiles:profile_id (
              display_name
            )
          )
        `)

      // Status filter
      if (filters?.status === 'active') {
        query = query.eq('is_archived', false)
      } else if (filters?.status === 'archived') {
        query = query.eq('is_archived', true)
      }

      // Search filter
      if (filters?.search) {
        const search = `%${filters.search}%`
        query = query.or(`first_name.ilike.${search},last_name.ilike.${search},client_id.ilike.${search},email.ilike.${search}`)
      }

      // Tags filter
      if (filters?.tags && filters.tags.length > 0) {
        query = query.overlaps('tags', filters.tags)
      }

      // Primary professional filter
      if (filters?.primaryProfessionalId) {
        query = query.eq('primary_professional_id', filters.primaryProfessionalId)
      }

      // Date range filter
      if (filters?.dateRange) {
        query = query
          .gte('last_appointment_at', filters.dateRange.from)
          .lte('last_appointment_at', filters.dateRange.to)
      }

      // Sorting
      if (sort) {
        const ascending = sort.direction === 'asc'
        switch (sort.field) {
          case 'name':
            query = query.order('last_name', { ascending }).order('first_name', { ascending })
            break
          case 'clientId':
            query = query.order('client_id', { ascending })
            break
          case 'birthday':
            query = query.order('birthday', { ascending, nullsFirst: false })
            break
          case 'lastAppointment':
            query = query.order('last_appointment_at', { ascending, nullsFirst: false })
            break
          case 'createdAt':
            query = query.order('created_at', { ascending })
            break
        }
      } else {
        // Default sort: newest first
        query = query.order('created_at', { ascending: false })
      }

      const { data, error } = await query

      if (error) throw error

      // Transform to ClientListItem format
      return (data || []).map((row): ClientListItem => {
        // Supabase returns nested objects for single relations
        const professional = row.professionals as unknown as { id: string; profiles: { display_name: string } | null } | null
        return {
          id: row.id,
          clientId: row.client_id,
          firstName: row.first_name,
          lastName: row.last_name,
          birthday: row.birthday,
          email: row.email,
          cellPhone: row.cell_phone,
          lastAppointmentDateTime: row.last_appointment_at,
          status: row.is_archived ? 'archived' : 'active',
          tags: row.tags || [],
          primaryProfessionalId: row.primary_professional_id,
          primaryProfessionalName: professional?.profiles?.display_name || null,
        }
      })
    },
  })
}

/**
 * Fetch single client with all relations
 * Supports both UUID and client_id (CLI-XXXXX) formats
 */
export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: clientKeys.detail(id!),
    queryFn: async (): Promise<ClientWithRelations | undefined> => {
      if (!id) return undefined

      // Detect if id is UUID or client_id format
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      // Client ID format: CLI-XXXXXXX
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      const filterColumn = isUUID ? 'id' : 'client_id'

      const { data, error } = await supabase
        .from('clients')
        .select(`
          *,
          professionals:primary_professional_id (
            id,
            profiles:profile_id (
              display_name
            )
          ),
          responsible:responsible_client_id (
            id,
            client_id,
            first_name,
            last_name
          )
        `)
        .eq(filterColumn, id)
        .single()

      if (error) throw error
      if (!data) return undefined

      const professional = data.professionals as { id: string; profiles: { display_name: string } } | null
      const responsible = data.responsible as { id: string; client_id: string; first_name: string; last_name: string } | null

      // Transform to ClientWithRelations
      return {
        id: data.id,
        clientId: data.client_id,
        firstName: data.first_name,
        lastName: data.last_name,
        sex: data.sex,
        language: data.language,
        birthday: data.birthday,
        email: data.email,
        cellPhoneCountryCode: data.cell_phone_country_code || '+1',
        cellPhone: data.cell_phone,
        homePhoneCountryCode: data.home_phone_country_code || '+1',
        homePhone: data.home_phone,
        workPhoneCountryCode: data.work_phone_country_code || '+1',
        workPhone: data.work_phone,
        workPhoneExtension: data.work_phone_extension,
        streetNumber: data.street_number,
        streetName: data.street_name,
        apartment: data.apartment,
        city: data.city,
        province: data.province,
        country: data.country || 'Canada',
        postalCode: data.postal_code,
        lastAppointmentDateTime: data.last_appointment_at,
        lastAppointmentService: data.last_appointment_service,
        lastAppointmentProfessional: data.last_appointment_professional,
        primaryProfessionalId: data.primary_professional_id,
        referredBy: data.referred_by,
        customField: data.custom_field,
        tags: data.tags || [],
        createdAt: data.created_at,
        isArchived: data.is_archived,
        responsibleClientId: data.responsible_client_id,
        balanceCents: data.balance_cents || 0,
        primaryProfessional: professional ? {
          id: professional.id,
          displayName: professional.profiles?.display_name || '',
        } : null,
        responsibleClient: responsible ? {
          clientId: responsible.client_id,
          firstName: responsible.first_name,
          lastName: responsible.last_name,
        } : null,
      }
    },
    enabled: !!id,
  })
}

/**
 * Fetch multiple clients by their UUIDs
 */
export function useClientsByIds(ids: string[]) {
  return useQuery({
    queryKey: clientKeys.batch(ids),
    queryFn: () => api.fetchClientsByIds(ids),
    enabled: ids.length > 0,
  })
}

/**
 * Get unique tags from all clients (for filter dropdown)
 */
export function useClientTags() {
  return useQuery({
    queryKey: [...clientKeys.all, 'tags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('tags')

      if (error) throw error

      // Extract unique tags
      const tags = new Set<string>()
      data?.forEach(row => {
        row.tags?.forEach((tag: string) => tags.add(tag))
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
      const { data, error } = await supabase
        .from('professionals')
        .select(`
          id,
          profiles:profile_id (
            display_name
          )
        `)
        .eq('status', 'active')

      if (error) throw error

      return (data || []).map(row => {
        const profile = row.profiles as unknown as { display_name: string } | null
        return {
          id: row.id,
          displayName: profile?.display_name || 'Unknown',
        }
      })
    },
  })
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new client (full form - from NewClientDrawer)
 */
export function useCreateClient() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateClientInput) => api.createClient(input),
    onSuccess: () => {
      // Invalidate all client queries to refetch lists
      queryClient.invalidateQueries({ queryKey: clientKeys.all })
    },
  })
}

/**
 * Create a new client with minimal fields (from ClientPickerDrawer)
 */
export function useCreateClientMinimal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateClientMinimalInput) => api.createClientMinimal(input),
    onSuccess: () => {
      // Invalidate all client queries to refetch lists
      queryClient.invalidateQueries({ queryKey: clientKeys.all })
    },
  })
}

/**
 * Update an existing client
 */
export function useUpdateClient() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ clientId, updates }: { clientId: string; updates: UpdateClientInput }) =>
      api.updateClient(clientId, updates),
    onSuccess: (_, { clientId }) => {
      // Invalidate specific client query and lists
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) })
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() })
    },
  })
}

// =============================================================================
// CLIENT RELATIONS
// =============================================================================

export const clientRelationKeys = {
  all: ['client-relations'] as const,
  client: (clientId: string) => [...clientRelationKeys.all, clientId] as const,
}

/**
 * Fetch relations for a client
 */
export function useClientRelations(clientId: string | undefined) {
  return useQuery({
    queryKey: clientRelationKeys.client(clientId!),
    queryFn: () => api.fetchClientRelations(clientId!),
    enabled: !!clientId,
  })
}

/**
 * Create a new client relation
 */
export function useCreateClientRelation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.createClientRelation,
    onSuccess: (_, input) => {
      // Invalidate relations for both clients involved
      queryClient.invalidateQueries({ queryKey: clientRelationKeys.client(input.clientId) })
      queryClient.invalidateQueries({ queryKey: clientRelationKeys.client(input.relatedClientId) })
    },
  })
}

/**
 * Delete a client relation (and its inverse)
 */
export function useDeleteClientRelation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { relationId: string; clientId: string; relatedClientId: string }) =>
      api.deleteClientRelation(params.relationId),
    onSuccess: (_, { clientId, relatedClientId }) => {
      // Invalidate both clients' relations since we delete bidirectionally
      queryClient.invalidateQueries({ queryKey: clientRelationKeys.client(clientId) })
      queryClient.invalidateQueries({ queryKey: clientRelationKeys.client(relatedClientId) })
    },
  })
}

// =============================================================================
// CONSULTATION REQUESTS
// =============================================================================

export const consultationRequestKeys = {
  all: ['consultationRequests'] as const,
  client: (clientId: string) => [...consultationRequestKeys.all, 'client', clientId] as const,
}

/**
 * Fetch consultation requests (demandes) for a specific client
 */
export function useClientConsultationRequests(clientId: string | undefined) {
  return useQuery({
    queryKey: consultationRequestKeys.client(clientId || ''),
    queryFn: () => api.fetchClientConsultationRequests(clientId!),
    enabled: !!clientId,
  })
}
