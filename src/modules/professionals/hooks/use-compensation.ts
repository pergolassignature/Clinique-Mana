import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import {
  deleteCompensationDefault,
  deleteProfessionalMargin,
  deleteProfessionalRecognition,
  deleteRecognitionRule,
  fetchCompensationKinds,
  fetchCompensationTerms,
  fetchProfessionalCompensation,
  setCompensationDefault,
  setProfessionalMargin,
  setProfessionalRecognition,
  setRecognitionRule,
  type DefaultRangeInput,
  type LevelInput,
  type MarginInput,
  type RecognitionRuleInput,
} from '../api/compensation'
import { compensationTermsKeys, professionalKeys } from './keys'
import { showMutationError, type MutationFeedback } from './mutation-feedback'
import { refreshProfessionalHistory } from './use-professional-record'

const C = 'modules.professionals.record.compensation'
const S = 'modules.professionals.settings.compensation'

// --- A professional's terms (the record's « Rémunération et fiscalité » tab) ----------------------

const compensationQuery = (id: string) =>
  queryOptions({ queryKey: professionalKeys.compensation(id), queryFn: () => fetchProfessionalCompensation(id) })

/** Needs `professionals.compensation`: pass `enabled` from `can`. */
export function useProfessionalCompensation(id: string, enabled: boolean) {
  return useQuery({ ...compensationQuery(id), enabled: enabled && id !== '' })
}

export function prefetchProfessionalCompensation(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(compensationQuery(id))
}

/**
 * A change to a professional's margins or levels: the entry is refetched with the history's first
 * page (it gains the sentence), awaited so the dialog closes onto fresh data. A refusal goes to the
 * dialog (`feedback`), its HINT routing it.
 */
function useProfessionalTermsMutation<V, R>(id: string, mutationFn: (variables: V) => Promise<R>, success: (result: R) => string, feedback: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async (result) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: professionalKeys.compensation(id) }), refreshProfessionalHistory(queryClient, id)])
      toast.success(success(result))
    },
    onError: (error) => {
      // A refusal often means someone else changed the series: show what is stored now.
      void queryClient.invalidateQueries({ queryKey: professionalKeys.compensation(id) })
      showMutationError(queryClient, error, feedback)
    },
  })
}

export function useSetProfessionalMargin(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(id, (input: MarginInput) => setProfessionalMargin(id, input), ({ warning }) => t(warning ? `${C}.margin.savedOutside` : `${C}.margin.saved`), feedback)
}

export function useDeleteProfessionalMargin(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(id, (rowId: string) => deleteProfessionalMargin(rowId), () => t(`${C}.margin.deleted`), feedback)
}

export function useSetProfessionalRecognition(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(id, (input: LevelInput) => setProfessionalRecognition(id, input), () => t(`${C}.recognition.saved`), feedback)
}

export function useDeleteProfessionalRecognition(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(id, (rowId: string) => deleteProfessionalRecognition(rowId), () => t(`${C}.recognition.deleted`), feedback)
}

// --- The clinic's terms (Paramètres → Rémunération) ------------------------------------------------

const kindsQuery = queryOptions({ queryKey: compensationTermsKeys.kinds(), queryFn: fetchCompensationKinds, staleTime: Infinity })

/** The kinds, read once per session (a global catalogue changed by migration). */
export function useCompensationKinds(enabled = true) {
  return useQuery({ ...kindsQuery, enabled })
}

export function prefetchCompensationKinds(queryClient: QueryClient): Promise<void> {
  return queryClient.prefetchQuery(kindsQuery)
}

export function useCompensationTerms() {
  return useQuery({ queryKey: compensationTermsKeys.terms(), queryFn: fetchCompensationTerms })
}

/**
 * A change to the clinic's defaults or rules: the terms are refetched (awaited), and so is every
 * professional's entry (what is in force follows the defaults), in the background. Refusals go to
 * the dialog; the terms are refetched then too (another admin may have changed them).
 */
function useClinicTermsMutation<V>(mutationFn: (variables: V) => Promise<void>, successMessage: string, feedback: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: professionalKeys.compensations() })
      await queryClient.invalidateQueries({ queryKey: compensationTermsKeys.terms() })
      toast.success(successMessage)
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: compensationTermsKeys.terms() })
      showMutationError(queryClient, error, feedback)
    },
  })
}

export function useSetCompensationDefault(feedback: MutationFeedback) {
  return useClinicTermsMutation((input: DefaultRangeInput) => setCompensationDefault(input), t(`${S}.defaults.saved`), feedback)
}

export function useDeleteCompensationDefault(feedback: MutationFeedback) {
  return useClinicTermsMutation((id: string) => deleteCompensationDefault(id), t(`${S}.defaults.deleted`), feedback)
}

export function useSetRecognitionRule(feedback: MutationFeedback) {
  return useClinicTermsMutation((input: RecognitionRuleInput) => setRecognitionRule(input), t(`${S}.rules.saved`), feedback)
}

export function useDeleteRecognitionRule(feedback: MutationFeedback) {
  return useClinicTermsMutation((id: string) => deleteRecognitionRule(id), t(`${S}.rules.deleted`), feedback)
}
