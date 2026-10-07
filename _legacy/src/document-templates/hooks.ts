// src/document-templates/hooks.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchTemplates,
  fetchTemplatesByKey,
  fetchPublishedTemplate,
  fetchTemplateById,
  fetchDocumentInstancesBySubject,
  fetchLatestDocumentInstance,
  fetchDocumentInstanceById,
  createTemplate,
  updateTemplateDraft,
  archiveTemplate,
  publishTemplate,
  createNewVersion,
  generateDocumentFromTemplate,
  syncDocumentInstanceFromDocuSeal,
} from './api'
import type { CreateTemplateInput, UpdateTemplateDraftInput, GenerateDocumentInput, DocumentInstanceStatus } from './types'
import { TEMPLATE_KEYS } from './constants'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const templateKeys = {
  all: ['document-templates'] as const,
  byKey: (key: string) => [...templateKeys.all, 'key', key] as const,
  published: (key: string) => [...templateKeys.all, 'published', key] as const,
  byId: (id: string) => [...templateKeys.all, 'id', id] as const,
}

export const documentInstanceKeys = {
  all: ['document-instances'] as const,
  bySubject: (subjectType: string, subjectId: string) =>
    [...documentInstanceKeys.all, 'subject', subjectType, subjectId] as const,
  latest: (templateKey: string, subjectType: string, subjectId: string) =>
    [...documentInstanceKeys.all, 'latest', templateKey, subjectType, subjectId] as const,
  byId: (id: string) => [...documentInstanceKeys.all, 'id', id] as const,
}

// =============================================================================
// QUERIES
// =============================================================================

export function useTemplates() {
  return useQuery({
    queryKey: templateKeys.all,
    queryFn: fetchTemplates,
  })
}

export function useTemplatesByKey(key: string | undefined) {
  return useQuery({
    queryKey: templateKeys.byKey(key!),
    queryFn: () => fetchTemplatesByKey(key!),
    enabled: !!key,
  })
}

export function usePublishedTemplate(key: string | undefined) {
  return useQuery({
    queryKey: templateKeys.published(key!),
    queryFn: () => fetchPublishedTemplate(key!),
    enabled: !!key,
  })
}

export function useTemplateById(id: string | undefined) {
  return useQuery({
    queryKey: templateKeys.byId(id!),
    queryFn: () => fetchTemplateById(id!),
    enabled: !!id,
  })
}

// =============================================================================
// DOCUMENT INSTANCE QUERIES
// =============================================================================

export function useDocumentInstancesBySubject(
  subjectType: 'professional' | 'client' | undefined,
  subjectId: string | undefined
) {
  return useQuery({
    queryKey: documentInstanceKeys.bySubject(subjectType!, subjectId!),
    queryFn: () => fetchDocumentInstancesBySubject(subjectType!, subjectId!),
    enabled: !!subjectType && !!subjectId,
  })
}

export function useLatestDocumentInstance(
  templateKey: string | undefined,
  subjectType: 'professional' | 'client' | undefined,
  subjectId: string | undefined
) {
  return useQuery({
    queryKey: documentInstanceKeys.latest(templateKey!, subjectType!, subjectId!),
    queryFn: () => fetchLatestDocumentInstance(templateKey!, subjectType!, subjectId!),
    enabled: !!templateKey && !!subjectType && !!subjectId,
  })
}

export function useDocumentInstanceById(id: string | undefined) {
  return useQuery({
    queryKey: documentInstanceKeys.byId(id!),
    queryFn: () => fetchDocumentInstanceById(id!),
    enabled: !!id,
  })
}

/**
 * Helper hook for service contract status.
 * Provides a unified interface for contract state based on document instances.
 */
export function useServiceContractStatus(professionalId: string | undefined) {
  const { data: instance, isLoading } = useLatestDocumentInstance(
    TEMPLATE_KEYS.SERVICE_CONTRACT,
    'professional',
    professionalId
  )

  const status = instance?.status as DocumentInstanceStatus | null
  const isSigned = status === 'signed'
  const isSent = status === 'sent_to_docuseal'

  return {
    isLoading,
    hasContract: !!instance,
    instance,
    status,
    // Can generate when no instance, or current one is signed
    canGenerate: !instance || isSigned,
    isSigned,
    isSent,
  }
}

// =============================================================================
// MUTATIONS
// =============================================================================

export function useCreateTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateTemplateInput) => createTemplate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}

export function useUpdateTemplateDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTemplateDraftInput }) =>
      updateTemplateDraft(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}

export function usePublishTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => publishTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}

export function useCreateNewVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ key, baseFromVersion }: { key: string; baseFromVersion?: number }) =>
      createNewVersion(key, baseFromVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}

export function useArchiveTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => archiveTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}

export function useGenerateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: GenerateDocumentInput) => generateDocumentFromTemplate(input),
    onSuccess: (_data, variables) => {
      // Invalidate both template and document instance queries
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
      queryClient.invalidateQueries({ queryKey: documentInstanceKeys.all })
      // Also invalidate the specific subject's instances
      queryClient.invalidateQueries({
        queryKey: documentInstanceKeys.bySubject(variables.subjectType, variables.subjectId),
      })
      queryClient.invalidateQueries({
        queryKey: documentInstanceKeys.latest(variables.templateKey, variables.subjectType, variables.subjectId),
      })
    },
  })
}

/**
 * Sync document instance status from DocuSeal.
 * Useful when the webhook didn't fire or status is out of sync.
 */
export function useSyncDocumentStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (instanceId: string) => syncDocumentInstanceFromDocuSeal(instanceId),
    onSuccess: (result) => {
      if (result.synced && result.instance) {
        // Invalidate all document instance queries to reflect the change
        queryClient.invalidateQueries({ queryKey: documentInstanceKeys.all })
      }
    },
  })
}
