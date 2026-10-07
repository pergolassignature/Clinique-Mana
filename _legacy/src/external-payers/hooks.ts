import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type {
  CreateIvacPayerInput,
  UpdateIvacPayerInput,
  CreatePaePayerInput,
  UpdatePaePayerInput,
  UpdateClinicSettingsInput,
  UpsertProfessionalIvacNumberInput,
} from './types'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const externalPayerKeys = {
  all: ['external-payers'] as const,
  byClient: (clientId: string) => [...externalPayerKeys.all, 'client', clientId] as const,
  activeByClient: (clientId: string) => [...externalPayerKeys.all, 'client', clientId, 'active'] as const,
}

export const clinicSettingsKeys = {
  all: ['clinic-settings'] as const,
  detail: () => [...clinicSettingsKeys.all, 'detail'] as const,
}

export const professionalIvacKeys = {
  all: ['professional-ivac'] as const,
  list: () => [...professionalIvacKeys.all, 'list'] as const,
  byProfessional: (professionalId: string) => [...professionalIvacKeys.all, 'professional', professionalId] as const,
}

// =============================================================================
// CLINIC SETTINGS QUERIES & MUTATIONS
// =============================================================================

export function useClinicSettings() {
  return useQuery({
    queryKey: clinicSettingsKeys.detail(),
    queryFn: () => api.fetchClinicSettings(),
  })
}

export function useUpdateClinicSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateClinicSettingsInput) => api.updateClinicSettings(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clinicSettingsKeys.all })
    },
  })
}

// =============================================================================
// PROFESSIONAL IVAC NUMBER QUERIES & MUTATIONS
// =============================================================================

// UUID regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function useProfessionalIvacNumber(professionalId: string | undefined) {
  const isValidUuid = professionalId && UUID_REGEX.test(professionalId)
  return useQuery({
    queryKey: professionalIvacKeys.byProfessional(professionalId!),
    queryFn: () => api.fetchProfessionalIvacNumber(professionalId!),
    enabled: !!isValidUuid,
  })
}

export function useAllProfessionalIvacNumbers() {
  return useQuery({
    queryKey: professionalIvacKeys.list(),
    queryFn: () => api.fetchAllProfessionalIvacNumbers(),
  })
}

export function useUpsertProfessionalIvacNumber() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpsertProfessionalIvacNumberInput) => api.upsertProfessionalIvacNumber(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: professionalIvacKeys.byProfessional(variables.professional_id) })
      queryClient.invalidateQueries({ queryKey: professionalIvacKeys.list() })
    },
  })
}

export function useDeleteProfessionalIvacNumber() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (professionalId: string) => api.deleteProfessionalIvacNumber(professionalId),
    onSuccess: (_, professionalId) => {
      queryClient.invalidateQueries({ queryKey: professionalIvacKeys.byProfessional(professionalId) })
      queryClient.invalidateQueries({ queryKey: professionalIvacKeys.list() })
    },
  })
}

// =============================================================================
// CLIENT EXTERNAL PAYERS QUERIES
// =============================================================================

export function useClientExternalPayers(clientId: string | undefined) {
  const isValidUuid = clientId && UUID_REGEX.test(clientId)
  return useQuery({
    queryKey: externalPayerKeys.byClient(clientId!),
    queryFn: () => api.fetchClientExternalPayers(clientId!),
    enabled: !!isValidUuid,
  })
}

export function useActiveClientExternalPayers(clientId: string | undefined) {
  const isValidUuid = clientId && UUID_REGEX.test(clientId)
  return useQuery({
    queryKey: externalPayerKeys.activeByClient(clientId!),
    queryFn: () => api.fetchActiveClientExternalPayers(clientId!),
    enabled: !!isValidUuid,
  })
}

// =============================================================================
// IVAC PAYER MUTATIONS
// =============================================================================

export function useCreateIvacPayer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateIvacPayerInput) => api.createIvacPayer(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: externalPayerKeys.byClient(variables.client_id) })
    },
  })
}

export function useUpdateIvacPayer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ payer_id, input }: { payer_id: string; input: UpdateIvacPayerInput; client_id: string }) =>
      api.updateIvacPayer(payer_id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: externalPayerKeys.byClient(variables.client_id) })
    },
  })
}

// =============================================================================
// PAE PAYER MUTATIONS
// =============================================================================

export function useCreatePaePayer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreatePaePayerInput) => api.createPaePayer(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: externalPayerKeys.byClient(variables.client_id) })
    },
  })
}

export function useUpdatePaePayer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ payer_id, input }: { payer_id: string; input: UpdatePaePayerInput; client_id: string }) =>
      api.updatePaePayer(payer_id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: externalPayerKeys.byClient(variables.client_id) })
    },
  })
}

// =============================================================================
// DEACTIVATE/REACTIVATE/DELETE PAYER MUTATIONS
// =============================================================================

export function useDeactivateExternalPayer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ payer_id }: { payer_id: string; client_id: string }) =>
      api.deactivateExternalPayer(payer_id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: externalPayerKeys.byClient(variables.client_id) })
    },
  })
}

export function useReactivateExternalPayer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ payer_id }: { payer_id: string; client_id: string }) =>
      api.reactivateExternalPayer(payer_id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: externalPayerKeys.byClient(variables.client_id) })
    },
  })
}

export function useDeleteExternalPayer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ payer_id }: { payer_id: string; client_id: string }) =>
      api.deleteExternalPayer(payer_id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: externalPayerKeys.byClient(variables.client_id) })
    },
  })
}
