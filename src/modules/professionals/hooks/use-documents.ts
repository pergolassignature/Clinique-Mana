import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { notificationKeys } from '@/core/notifications/hooks'
import { previewErrorMessage } from '@/core/storage/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { toast } from '@/shared/ui/sonner'
import {
  deleteProfessionalDocument,
  documentDownloadUrl,
  discardConsentDraft,
  fetchConsentVersions,
  fetchMyDocuments,
  fetchProfessionalDocuments,
  publishConsentVersion,
  rejectProfessionalDocument,
  saveConsentDraft,
  setProfessionalDocumentExpiry,
  uploadProfessionalDocument,
  verifyProfessionalDocument,
  type DocumentUploadInput,
  type RejectResult,
} from '../api/documents'
import { professionalCatalogKeys, professionalKeys, professionalsSettingsKeys } from './keys'
import { showMutationError, type MutationFeedback } from './mutation-feedback'
import { refreshProfessionalHistory } from './use-professional-record'

const T = 'modules.professionals.documents.toasts'

// --- Reads ---------------------------------------------------------------------------------------

/** The documents' read, shared with the fiche (its photo, P4-202). */
export const documentsQuery = (id: string) =>
  queryOptions({ queryKey: professionalKeys.documents(id), queryFn: () => fetchProfessionalDocuments(id), staleTime: 30_000 })

/** The Documents tab's one read (`get_professional_documents`): fetched with the tab, or on its hover. */
export function useProfessionalDocuments(id: string) {
  return useQuery({ ...documentsQuery(id), enabled: id !== '' })
}

/** Documents' hover or focus: the documents with the tab's chunk. */
export function prefetchProfessionalDocuments(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(documentsQuery(id))
}

/** « Mes documents »: the signed-in professional's own documents (null without a file). */
export function useMyDocuments() {
  return useQuery({ queryKey: professionalKeys.myDocuments(), queryFn: fetchMyDocuments, staleTime: 30_000 })
}

/** « Paramètres → Consentements ». */
export function useConsentVersions() {
  return useQuery({ queryKey: professionalsSettingsKeys.consents(), queryFn: () => fetchConsentVersions(), staleTime: 60_000 })
}

/**
 * The versions as the database holds them now (refetched, never the cache), for the checks before
 * a save or a publish (P4-463): a colleague's edit since the page loaded is said, never overwritten
 * nor published unseen.
 */
export function fetchCurrentConsentVersions(queryClient: QueryClient) {
  return queryClient.fetchQuery({ queryKey: professionalsSettingsKeys.consents(), queryFn: () => fetchConsentVersions(), staleTime: 0 })
}

// --- Document changes ----------------------------------------------------------------------------

/**
 * After any change to a professional's documents, made or refused: the record (its documents and
 * readiness), the lists (« Documents 2 / 3 », the insurance's state), the history's first page,
 * « Utilisé par » of « Documents requis » (see `keys.ts`), « Mes documents » (an admin who practises
 * sees her file both ways) and the notices (the SQL closes « Document à vérifier »; the bell and
 * « À surveiller » follow at once instead of at the next poll). Queries not on screen are only
 * marked stale.
 */
function refreshAfterDocumentChange(queryClient: QueryClient, professionalId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: professionalKeys.record(professionalId) }),
    queryClient.invalidateQueries({ queryKey: professionalKeys.myDocuments() }),
    queryClient.invalidateQueries({ queryKey: professionalKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.usage() }),
    queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
    refreshProfessionalHistory(queryClient, professionalId),
  ])
}

/**
 * Upload then attach (the dropzone shows the steps; a failure is thrown to it, which words it with
 * `uploadErrorMessage`). The toast says whether the document still waits for a review.
 */
export function useUploadDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DocumentUploadInput) => uploadProfessionalDocument(input),
    onSettled: (_data, _error, { professionalId }) => refreshAfterDocumentChange(queryClient, professionalId),
  })
}

interface DocumentVariables {
  professionalId: string
  documentId: string
}

/** « Vérifier », with the end date for a type with a rule. */
export function useVerifyDocument(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, expiresOn }: DocumentVariables & { expiresOn: string | null }) => verifyProfessionalDocument(documentId, expiresOn),
    onSuccess: () => toast.success(t(`${T}.verified`)),
    onError: (error) => showMutationError(queryClient, error, feedback),
    onSettled: (_data, _error, { professionalId }) => refreshAfterDocumentChange(queryClient, professionalId),
  })
}

/** « Modifier l'échéance ». */
export function useSetDocumentExpiry(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, expiresOn }: DocumentVariables & { expiresOn: string }) => setProfessionalDocumentExpiry(documentId, expiresOn),
    onSuccess: () => toast.success(t(`${T}.redated`)),
    onError: (error) => showMutationError(queryClient, error, feedback),
    onSettled: (_data, _error, { professionalId }) => refreshAfterDocumentChange(queryClient, professionalId),
  })
}

/** « Supprimer » (`professionals.documents.delete`). */
export function useDeleteDocument(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId }: DocumentVariables) => deleteProfessionalDocument(documentId),
    onSuccess: () => toast.success(t(`${T}.deleted`)),
    onError: (error) => showMutationError(queryClient, error, feedback),
    onSettled: (_data, _error, { professionalId }) => refreshAfterDocumentChange(queryClient, professionalId),
  })
}

/** The toast after « Refuser »: whether the professional was told by email, and if not why (P4-451). */
export function rejectToast(result: RejectResult, firstName: string): { kind: 'success' | 'warning'; message: string } {
  if (result.emailed) return { kind: 'success', message: t(`${T}.rejectedEmailed`, { firstName }) }
  if (result.emailProblem === null) return { kind: 'success', message: t(`${T}.rejected`) }
  return { kind: 'warning', message: t(`${T}.rejectedNotEmailed`, { firstName }) }
}

/** « Refuser » (the reason is emailed to the professional for a file she sent). */
export function useRejectDocument(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, reason }: DocumentVariables & { reason: string; firstName: string }) => rejectProfessionalDocument(documentId, reason),
    onSuccess: (result, { firstName }) => {
      const { kind, message } = rejectToast(result, firstName)
      if (kind === 'success') toast.success(message)
      else toast.warning(message)
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
    onSettled: (_data, _error, { professionalId }) => refreshAfterDocumentChange(queryClient, professionalId),
  })
}

/** Starts the browser's download of a signed URL (it answers with `Content-Disposition: attachment`). */
function startDownload(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

/**
 * « Télécharger »: a new signed URL at each press (never kept: `gcTime` 0, P3-33), then the
 * browser's download. A refusal is a toast: too many requests (with when to retry), else « Le
 * fichier n'a pas pu être téléchargé » (gone, or the network).
 */
export function useDocumentDownload() {
  return useMutation({
    mutationFn: (fileId: string) => documentDownloadUrl(fileId),
    gcTime: 0,
    onSuccess: startDownload,
    onError: (error) =>
      toast.error(
        error instanceof FunctionCallError && error.code === 'rate_limited' ? previewErrorMessage(error) : t('modules.professionals.documents.preview.downloadFailed'),
      ),
  })
}

// --- « Consentements » ---------------------------------------------------------------------------

function useConsentMutation<V, R>(fn: (variables: V) => Promise<R>, message: string, feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: V) => fn(variables),
    onSuccess: () => toast.success(message),
    onError: (error) => showMutationError(queryClient, error, feedback),
    onSettled: () => queryClient.invalidateQueries({ queryKey: professionalsSettingsKeys.consents() }),
  })
}

export const useSaveConsentDraft = (feedback?: MutationFeedback) => useConsentMutation(saveConsentDraft, t(`${T}.draftSaved`), feedback)
export const usePublishConsentVersion = (feedback?: MutationFeedback) => useConsentMutation(publishConsentVersion, t(`${T}.published`), feedback)
export const useDiscardConsentDraft = (feedback?: MutationFeedback) => useConsentMutation(discardConsentDraft, t(`${T}.draftDiscarded`), feedback)
