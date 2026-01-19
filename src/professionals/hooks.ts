import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type {
  ProfessionalsListFilters,
  ProfessionalsListSort,
  CreateProfessionalInput,
  UpdateProfessionalInput,
  UpdateProfessionalStatusInput,
  CreateInviteInput,
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
}

export const specialtyKeys = {
  all: ['specialties'] as const,
  list: () => [...specialtyKeys.all, 'list'] as const,
  byCategory: () => [...specialtyKeys.all, 'by-category'] as const,
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
    mutationFn: (input: SubmitQuestionnaireInput) => api.submitQuestionnaire(input),
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
    mutationFn: (input: SubmitQuestionnaireInput) => api.saveDraftQuestionnaire(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: professionalKeys.questionnaire(data.professional_id),
      })
    },
  })
}

export function useReviewQuestionnaire() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ReviewQuestionnaireInput) => api.reviewQuestionnaire(input),
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
