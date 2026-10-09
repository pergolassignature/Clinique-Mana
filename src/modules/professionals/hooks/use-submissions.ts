import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import {
  applyProfessionalSubmission,
  cancelProfessionalSubmission,
  fetchProfessionalSubmissions,
  fetchSubmissionReview,
  rejectProfessionalSubmission,
} from '../api/submissions'
import { PRIVATE_SUBMISSION_FIELDS, SET_SUBMISSION_FIELDS, type SubmissionField, type SubmissionKind } from '../lib/constants'
import { professionalCatalogKeys, professionalKeys } from './keys'
import { showMutationError, type MutationFeedback } from './mutation-feedback'
import { refreshProfessionalHistory } from './use-professional-record'

const T = 'modules.professionals.submission.toasts'

// --- Reads ---------------------------------------------------------------------------------------

const submissionsQuery = (id: string) =>
  queryOptions({ queryKey: professionalKeys.submissions(id), queryFn: () => fetchProfessionalSubmissions(id), staleTime: 30_000 })

/** « Questionnaire et mises à jour » (Documents tab): fetched with the tab, or on its hover. */
export function useProfessionalSubmissions(id: string) {
  return useQuery({ ...submissionsQuery(id), enabled: id !== '' })
}

/** Documents' hover or focus: the file's submissions with the tab's chunk. */
export function prefetchProfessionalSubmissions(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(submissionsQuery(id))
}

/**
 * One submission's review, read when the sheet opens (or on « Réviser »'s hover). Not refetched on
 * focus: the reviewer's ticks belong to what she is reading; a decision refetches what changed.
 */
const reviewQuery = (submissionId: string) =>
  queryOptions({ queryKey: professionalKeys.submissionReview(submissionId), queryFn: () => fetchSubmissionReview(submissionId), staleTime: 30_000 })

export function useSubmissionReview(submissionId: string) {
  return useQuery({ ...reviewQuery(submissionId), refetchOnWindowFocus: false })
}

export function prefetchSubmissionReview(queryClient: QueryClient, submissionId: string): Promise<void> {
  return queryClient.prefetchQuery(reviewQuery(submissionId))
}

// --- Decisions -----------------------------------------------------------------------------------

/**
 * After a decision, made or refused: the record (its readiness, onboarding line and submissions),
 * the lists (statuses and « À surveiller ») and the history's first page. The review is marked
 * stale; a refused decision also refetches it in place, under the sheet's ticks (a refusal often
 * means the submission changed meanwhile: decided by a colleague, closed). A decision made leaves
 * it as shown while the sheet closes.
 */
function refreshAfterDecision(queryClient: QueryClient, professionalId: string, submissionId: string, decided: boolean) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: professionalKeys.submissionReview(submissionId), exact: true, refetchType: decided ? 'none' : 'active' }),
    queryClient.invalidateQueries({ queryKey: professionalKeys.record(professionalId) }),
    queryClient.invalidateQueries({ queryKey: professionalKeys.lists() }),
    refreshProfessionalHistory(queryClient, professionalId),
  ])
}

export interface ApplyVariables {
  professionalId: string
  submissionId: string
  kind: SubmissionKind
  fields: readonly SubmissionField[]
}

/**
 * What an applied submission changed beyond the record (P4-374, the `keys.ts` table): a private
 * field the file's masks (`private(id)`), a set the lists' « Utilisé par » counts (`usage()`).
 */
function refreshAfterApply(queryClient: QueryClient, professionalId: string, fields: readonly SubmissionField[]) {
  return Promise.all([
    fields.some((field) => PRIVATE_SUBMISSION_FIELDS.has(field)) && queryClient.invalidateQueries({ queryKey: professionalKeys.private(professionalId) }),
    fields.some((field) => SET_SUBMISSION_FIELDS.has(field)) && queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.usage() }),
  ])
}

/**
 * « Appliquer les changements sélectionnés »: one call (P4-176). The toast says how many changes the
 * file received, or that it was approved without one. A refusal goes to the sheet (`feedback`).
 */
export function useApplySubmission(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ submissionId, fields }: ApplyVariables) => applyProfessionalSubmission(submissionId, fields),
    onSuccess: (_data, { professionalId, kind, fields }) => {
      void refreshAfterApply(queryClient, professionalId, fields)
      const count = fields.length
      if (count === 0) toast.success(t(`${T}.approvedUnchanged.${kind}`))
      else toast.success(t(count === 1 ? `${T}.appliedOne.${kind}` : `${T}.applied.${kind}`, { count: String(count) }))
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
    onSettled: (_data, error, { professionalId, submissionId }) => refreshAfterDecision(queryClient, professionalId, submissionId, !error),
  })
}

export interface ReturnVariables {
  professionalId: string
  submissionId: string
  note: string
  firstName: string
}

/** « Renvoyer au professionnel »: back to a draft with the note, which the professional reads in her questionnaire. */
export function useReturnSubmission(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ submissionId, note }: ReturnVariables) => rejectProfessionalSubmission(submissionId, note),
    onSuccess: (_data, { firstName }) => {
      toast.success(t(`${T}.returned`, { firstName }))
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
    onSettled: (_data, error, { professionalId, submissionId }) => refreshAfterDecision(queryClient, professionalId, submissionId, !error),
  })
}

export interface CancelVariables {
  professionalId: string
  submissionId: string
  firstName: string
}

/**
 * « Fermer la demande » (P4-421): an open update closed without being applied. Refreshes what a
 * decision refreshes (the record with its submissions and onboarding line, the lists, the history).
 */
export function useCancelSubmission(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ submissionId }: CancelVariables) => cancelProfessionalSubmission(submissionId),
    onSuccess: (_data, { firstName }) => {
      toast.success(t(`${T}.cancelled`, { firstName }))
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
    onSettled: (_data, error, { professionalId, submissionId }) => refreshAfterDecision(queryClient, professionalId, submissionId, !error),
  })
}
