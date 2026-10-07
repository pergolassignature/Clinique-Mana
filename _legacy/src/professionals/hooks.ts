import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import * as api from './api'
import type {
  ProfessionalsListFilters,
  ProfessionalsListSort,
  CreateProfessionalInput,
  UpdateProfessionalInput,
  UpdateProfessionalStatusInput,
  CreateInviteInput,
  CreateUpdateRequestInput,
  UploadDocumentInput,
  VerifyDocumentInput,
  UpdateDocumentExpiryInput,
  AddSpecialtyInput,
  SubmitQuestionnaireInput,
  ReviewQuestionnaireInput,
} from './types'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const professionalKeys = {
  all: ['professionals'] as const,
  lists: () => [...professionalKeys.all, 'list'] as const,
  list: (filters?: ProfessionalsListFilters, sort?: ProfessionalsListSort) =>
    [...professionalKeys.lists(), { filters, sort }] as const,
  details: () => [...professionalKeys.all, 'detail'] as const,
  detail: (id: string) => [...professionalKeys.details(), id] as const,
  documents: (id: string) => [...professionalKeys.detail(id), 'documents'] as const,
  invites: (id: string) => [...professionalKeys.detail(id), 'invites'] as const,
  questionnaire: (id: string) => [...professionalKeys.detail(id), 'questionnaire'] as const,
  auditLog: (id: string) => [...professionalKeys.detail(id), 'audit'] as const,
  services: (id: string) => [...professionalKeys.detail(id), 'services'] as const,
  calendarConnection: (id: string) => [...professionalKeys.detail(id), 'calendar'] as const,
}

export const specialtyKeys = {
  all: ['specialties'] as const,
  list: () => [...specialtyKeys.all, 'list'] as const,
  byCategory: () => [...specialtyKeys.all, 'by-category'] as const,
}

export const professionKeys = {
  all: ['profession-titles'] as const,
  list: () => [...professionKeys.all, 'list'] as const,
  professional: (professionalId: string) => [...professionKeys.all, 'professional', professionalId] as const,
}

export const inviteKeys = {
  byToken: (token: string) => ['invite', 'token', token] as const,
}

// =============================================================================
// PROFESSIONALS QUERIES
// =============================================================================

export function useProfessionals(
  filters?: ProfessionalsListFilters,
  sort?: ProfessionalsListSort
) {
  return useQuery({
    queryKey: professionalKeys.list(filters, sort),
    queryFn: () => api.fetchProfessionals(filters, sort),
  })
}

export function useProfessional(id: string | undefined) {
  return useQuery({
    queryKey: professionalKeys.detail(id!),
    queryFn: () => api.fetchProfessional(id!),
    enabled: !!id,
  })
}

export function useProfessionalDocuments(id: string | undefined) {
  return useQuery({
    queryKey: professionalKeys.documents(id!),
    queryFn: () => api.fetchProfessionalDocuments(id!),
    enabled: !!id,
  })
}

export function useProfessionalInvites(id: string | undefined) {
  return useQuery({
    queryKey: professionalKeys.invites(id!),
    queryFn: () => api.fetchProfessionalInvites(id!),
    enabled: !!id,
  })
}

export function useProfessionalQuestionnaire(id: string | undefined) {
  return useQuery({
    queryKey: professionalKeys.questionnaire(id!),
    queryFn: () => api.fetchQuestionnaireSubmission(id!),
    enabled: !!id,
  })
}

export function useProfessionalAuditLog(id: string | undefined) {
  return useQuery({
    queryKey: professionalKeys.auditLog(id!),
    queryFn: () => api.fetchProfessionalAuditLog(id!),
    enabled: !!id,
  })
}

// =============================================================================
// SPECIALTIES QUERIES
// =============================================================================

export function useSpecialties() {
  return useQuery({
    queryKey: specialtyKeys.list(),
    queryFn: api.fetchSpecialties,
    staleTime: 1000 * 60 * 30, // 30 minutes - specialties rarely change
  })
}

export function useSpecialtiesByCategory() {
  return useQuery({
    queryKey: specialtyKeys.byCategory(),
    queryFn: api.fetchSpecialtiesByCategory,
    staleTime: 1000 * 60 * 30,
  })
}

// =============================================================================
// PROFESSION TITLES QUERIES
// =============================================================================

export function useProfessionTitles() {
  return useQuery({
    queryKey: professionKeys.list(),
    queryFn: api.fetchProfessionTitles,
    staleTime: 1000 * 60 * 30, // 30 minutes - titles rarely change
  })
}

export function useProfessionalProfessions(professionalId: string | undefined) {
  return useQuery({
    queryKey: professionKeys.professional(professionalId!),
    queryFn: () => api.fetchProfessionalProfessions(professionalId!),
    enabled: !!professionalId,
  })
}

// =============================================================================
// INVITE QUERY (PUBLIC)
// =============================================================================

export function useInviteByToken(token: string | undefined) {
  return useQuery({
    queryKey: inviteKeys.byToken(token!),
    queryFn: () => api.fetchInviteByToken(token!),
    enabled: !!token,
  })
}

// =============================================================================
// PROFESSIONALS MUTATIONS
// =============================================================================

export function useCreateProfessional() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateProfessionalInput) => api.createProfessional(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: professionalKeys.lists() })
    },
  })
}

export function useCreateProfessionalWithProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: api.CreateProfessionalWithProfileInput) =>
      api.createProfessionalWithProfile(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: professionalKeys.lists() })
    },
  })
}

export function useUpdateProfessional() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProfessionalInput }) =>
      api.updateProfessional(id, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: professionalKeys.detail(data.id) })
      queryClient.invalidateQueries({ queryKey: professionalKeys.lists() })
    },
  })
}

export function useUpdateProfessionalStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProfessionalStatusInput }) =>
      api.updateProfessionalStatus(id, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: professionalKeys.detail(data.id) })
      queryClient.invalidateQueries({ queryKey: professionalKeys.lists() })
    },
  })
}

// =============================================================================
// SPECIALTY MUTATIONS
// =============================================================================

export function useAddSpecialty() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: AddSpecialtyInput) => api.addProfessionalSpecialty(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

export function useRemoveSpecialty() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      professional_id,
      specialty_id,
    }: {
      professional_id: string
      specialty_id: string
    }) => api.removeProfessionalSpecialty(professional_id, specialty_id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

export function useUpdateSpecialtySpecialization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      professional_id,
      specialty_id,
      is_specialized,
    }: {
      professional_id: string
      specialty_id: string
      is_specialized: boolean
    }) => api.updateSpecialtySpecialization(professional_id, specialty_id, is_specialized),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

// =============================================================================
// MOTIF MUTATIONS
// =============================================================================

export function useAddMotif() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: api.AddMotifInput) => api.addProfessionalMotif(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

export function useRemoveMotif() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      professional_id,
      motif_key,
    }: {
      professional_id: string
      motif_key: string
    }) => api.removeProfessionalMotif(professional_id, motif_key),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

export function useUpdateMotifSpecialization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      professional_id,
      motif_id,
      is_specialized,
    }: {
      professional_id: string
      motif_id: string
      is_specialized: boolean
    }) => api.updateMotifSpecialization(professional_id, motif_id, is_specialized),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

export function useReplaceMotifs() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      professional_id,
      motif_keys,
    }: {
      professional_id: string
      motif_keys: string[]
    }) => api.replaceProfessionalMotifs(professional_id, motif_keys),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

// =============================================================================
// PROFESSION MUTATIONS
// =============================================================================

export function useAddProfession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: api.AddProfessionInput) => api.addProfessionalProfession(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionKeys.professional(variables.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

export function useUpdateProfession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      professional_id: string
      updates: { license_number?: string; is_primary?: boolean }
    }) => api.updateProfessionalProfession(id, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionKeys.professional(variables.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

export function useRemoveProfession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }: { id: string; professional_id: string }) =>
      api.removeProfessionalProfession(id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionKeys.professional(variables.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

export function useReplaceProfessions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: api.ReplaceProfessionsInput) =>
      api.replaceProfessionalProfessions(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionKeys.professional(variables.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

// =============================================================================
// DOCUMENT MUTATIONS
// =============================================================================

export function useUploadDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UploadDocumentInput) => api.uploadDocument(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.documents(data.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(data.professional_id),
      })
    },
  })
}

export function useVerifyDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: VerifyDocumentInput) => api.verifyDocument(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.documents(data.professional_id),
      })
    },
  })
}

export function useUpdateDocumentExpiry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateDocumentExpiryInput) => api.updateDocumentExpiry(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.documents(data.professional_id),
      })
    },
  })
}

export function useDeleteDocument() {
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    // Note: The caller should invalidate queries via their own onSuccess callback
    // since we don't have the professional_id here
  })
}

// =============================================================================
// INVITE MUTATIONS
// =============================================================================

export function useCreateInvite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateInviteInput) => api.createInvite(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.invites(data.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(data.professional_id),
      })
    },
  })
}

export function useMarkInviteSent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.markInviteSent(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.invites(data.professional_id),
      })
    },
  })
}

export function useRevokeInvite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.revokeInvite(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.invites(data.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(data.professional_id),
      })
    },
  })
}

export function useCreateUpdateRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateUpdateRequestInput) => api.createUpdateRequestInvite(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.invites(data.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(data.professional_id),
      })
    },
  })
}

// Public mutation for marking invite as opened
export function useMarkInviteOpened() {
  return useMutation({
    mutationFn: (token: string) => api.markInviteOpened(token),
  })
}

// =============================================================================
// QUESTIONNAIRE MUTATIONS
// =============================================================================

export function useSubmitQuestionnaire() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SubmitQuestionnaireInput) =>
      api.submitQuestionnaire({
        professional_id: input.professional_id,
        invite_id: input.invite_id,
        responses: input.responses,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.questionnaire(data.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(data.professional_id),
      })
    },
  })
}

export function useSaveDraftQuestionnaire() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SubmitQuestionnaireInput) =>
      api.saveDraftQuestionnaire({
        professional_id: input.professional_id,
        invite_id: input.invite_id,
        responses: input.responses,
      }),
    onSuccess: (_data, variables) => {
      // Use professional_id from variables since the new return type doesn't include it
      queryClient.invalidateQueries({
        queryKey: professionalKeys.questionnaire(variables.professional_id),
      })
    },
  })
}

export function useReviewQuestionnaire() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ReviewQuestionnaireInput) => api.reviewQuestionnaire(input),
    onSuccess: (data) => {
      // Invalidate questionnaire-specific query
      queryClient.invalidateQueries({
        queryKey: professionalKeys.questionnaire(data.professional_id),
      })
      // Invalidate detail to refresh the embedded latest_submission
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(data.professional_id),
      })
      // Invalidate audit log to show the review event
      queryClient.invalidateQueries({
        queryKey: professionalKeys.auditLog(data.professional_id),
      })
      // Invalidate list in case status-based filtering applies
      queryClient.invalidateQueries({
        queryKey: professionalKeys.lists(),
      })
    },
  })
}

export function useApplyQuestionnaire() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: api.ApplyQuestionnaireInput) => api.applyQuestionnaireToProfile(input),
    onSuccess: (result, variables) => {
      // Invalidate all related queries to refresh the data
      // This ensures UI reads from the authoritative professional record, not submission
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.questionnaire(variables.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.auditLog(variables.professional_id),
      })
      // Invalidate list in case status-based filtering applies
      queryClient.invalidateQueries({
        queryKey: professionalKeys.lists(),
      })
      // Result contains applied_at, fields_updated, specialties_replaced for UI feedback
      return result
    },
  })
}

// =============================================================================
// PROFESSIONAL SERVICES (Junction: professionals ↔ services)
// =============================================================================

export function useProfessionalServices(professionalId: string | undefined) {
  return useQuery({
    queryKey: professionalKeys.services(professionalId!),
    queryFn: () => api.fetchProfessionalServices(professionalId!),
    enabled: !!professionalId,
  })
}

export function useReplaceProfessionalServices() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      professional_id,
      servicesByTitle,
    }: {
      professional_id: string
      servicesByTitle: Record<string, string[]>
    }) => api.replaceProfessionalServices(professional_id, servicesByTitle),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.services(variables.professional_id),
      })
      queryClient.invalidateQueries({
        queryKey: professionalKeys.detail(variables.professional_id),
      })
    },
  })
}

// =============================================================================
// FICHE PDF GENERATION
// =============================================================================

export const ficheKeys = {
  all: ['fiche'] as const,
  data: (professionalId: string, professionTitleKey: string) =>
    [...ficheKeys.all, 'data', professionalId, professionTitleKey] as const,
}

// =============================================================================
// CALENDAR CONNECTION HOOKS
// =============================================================================

export interface CalendarConnection {
  id: string
  professional_id: string
  provider: 'google' | 'microsoft' | 'calendly'
  provider_email: string
  status: 'active' | 'expired' | 'revoked' | 'error'
  last_synced_at: string | null
  last_error: string | null
  created_at: string
}

export function useCalendarConnection(professionalId: string) {
  return useQuery({
    queryKey: professionalKeys.calendarConnection(professionalId),
    queryFn: async (): Promise<CalendarConnection | null> => {
      const { data, error } = await supabase
        .from('professional_calendar_connections')
        .select('id, professional_id, provider, provider_email, status, last_synced_at, last_error, created_at')
        .eq('professional_id', professionalId)
        .maybeSingle()

      if (error) throw error
      return data
    },
    enabled: !!professionalId,
  })
}

export function useConnectGoogleCalendar() {
  return useMutation({
    mutationFn: async (professionalId: string) => {
      // Ensure we have a valid session before calling the function
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session) {
        throw new Error('Session expirée. Veuillez vous reconnecter.')
      }

      const { data, error } = await supabase.functions.invoke('google-calendar-auth-url', {
        body: { professionalId },
      })
      if (error) throw error
      return { ...data, professionalId } as { authUrl: string; state: string; professionalId: string }
    },
    onSuccess: (data) => {
      // Store state and professional ID in sessionStorage for callback validation
      sessionStorage.setItem('gcal_oauth_state', data.state)
      sessionStorage.setItem('gcal_oauth_professional_id', data.professionalId)
      // Redirect to Google OAuth
      window.location.href = data.authUrl
    },
  })
}

export function useCompleteGoogleCalendarConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ code, state }: { code: string; state: string }) => {
      const { data, error } = await supabase.functions.invoke('google-calendar-callback', {
        body: { code, state },
      })
      if (error) throw error
      return data as { success: boolean; provider: string; email: string }
    },
    onSuccess: () => {
      // Invalidate all calendar connection queries
      queryClient.invalidateQueries({ queryKey: professionalKeys.all })
    },
  })
}

export function useSyncCalendar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (professionalId: string) => {
      const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
        body: { professionalId },
      })
      if (error) throw error
      return data as { success: boolean; busyBlocksCount: number; syncedAt: string }
    },
    onSuccess: (_, professionalId) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.calendarConnection(professionalId),
      })
      // Also invalidate availability queries to refresh busy blocks
      queryClient.invalidateQueries({ queryKey: ['availability'] })
    },
  })
}

export function useDisconnectCalendar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (professionalId: string) => {
      const { data, error } = await supabase.functions.invoke('google-calendar-disconnect', {
        body: { professionalId },
      })
      if (error) throw error
      return data as { success: boolean }
    },
    onSuccess: () => {
      // Invalidate all calendar connection queries
      queryClient.invalidateQueries({ queryKey: professionalKeys.all })
      // Also invalidate availability queries to remove busy blocks
      queryClient.invalidateQueries({ queryKey: ['availability'] })
    },
  })
}
