import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import {
  decideRetention,
  deleteClientAgreement,
  deleteCompensationRate,
  deleteProfessionalRetention,
  deleteRetentionGrid,
  endClientAgreement,
  fetchCompensationKinds,
  fetchCompensationTerms,
  fetchProfessionalCompensation,
  fetchRetentionReview,
  recordMonthlySessions,
  setClientAgreement,
  setCompensationRate,
  setRetentionGrid,
  type AgreementInput,
  type DecisionInput,
  type GridInput,
  type RateInput,
  type SessionEntryInput,
} from '../api/compensation'
import { formatPercent } from '../lib/compensation'
import { compensationTermsKeys, professionalKeys } from './keys'
import { showMutationError, type MutationFeedback } from './mutation-feedback'
import { refreshProfessionalHistory } from './use-professional-record'

const C = 'modules.professionals.record.compensation'
const S = 'modules.professionals.settings.compensation'
const R = 'modules.professionals.review'

// --- A professional's retention (the record's « Rémunération et fiscalité » tab) ----------------------

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
 * A change to a professional's sessions, rate or agreements: the entry is refetched with the
 * history's first page (awaited, so the dialog closes onto fresh data); the monthly reviews
 * follow in the background. A refusal goes to the dialog (`feedback`), its HINT routing it; the
 * entry and the reviews are refetched then too (a decision is taken from either).
 */
function useProfessionalTermsMutation<V, Res>(id: string, mutationFn: (variables: V) => Promise<Res>, success: (result: Res) => string, feedback: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async (result) => {
      void queryClient.invalidateQueries({ queryKey: professionalKeys.reviews() })
      await Promise.all([queryClient.invalidateQueries({ queryKey: professionalKeys.compensation(id) }), refreshProfessionalHistory(queryClient, id)])
      toast.success(success(result))
    },
    onError: (error) => {
      // A refusal often means someone else changed the series: show what is stored now.
      void queryClient.invalidateQueries({ queryKey: professionalKeys.compensation(id) })
      void queryClient.invalidateQueries({ queryKey: professionalKeys.reviews() })
      showMutationError(queryClient, error, feedback)
    },
  })
}

/** The record's « Ajouter les séances du mois »: one entry for this professional. */
export function useRecordSessions(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(
    id,
    ({ month, entry }: { month: string; entry: Omit<SessionEntryInput, 'professionalId'> }) => recordMonthlySessions(month, [{ ...entry, professionalId: id }]),
    () => t(`${C}.sessions.saved`),
    feedback,
  )
}

/**
 * A decision; the toast names the rate the database stored and says when it went down (the
 * notice email is 4b's, P4-191).
 */
export function useDecideRetention(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(
    id,
    (input: DecisionInput) => decideRetention(id, input),
    ({ pct, decreased }) => t(decreased ? `${C}.decision.savedDecreased` : `${C}.decision.saved`, { rate: formatPercent(pct) }),
    feedback,
  )
}

export function useDeleteRetention(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(id, (rowId: string) => deleteProfessionalRetention(rowId), () => t(`${C}.rate.deleted`), feedback)
}

export function useSetClientAgreement(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(id, (input: AgreementInput) => setClientAgreement(id, input), () => t(`${C}.agreements.saved`), feedback)
}

export function useEndClientAgreement(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(
    id,
    ({ rowId, effectiveTo }: { rowId: string; effectiveTo: string | null }) => endClientAgreement(rowId, effectiveTo),
    () => t(`${C}.agreements.ended`),
    feedback,
  )
}

export function useDeleteClientAgreement(id: string, feedback: MutationFeedback) {
  return useProfessionalTermsMutation(id, (rowId: string) => deleteClientAgreement(rowId), () => t(`${C}.agreements.deleted`), feedback)
}

// --- « Révision mensuelle » ---------------------------------------------------------------------------

/** One month's review; the previous month stays on screen while another loads. */
export function useRetentionReview(month: string) {
  return useQuery({
    queryKey: professionalKeys.review(month),
    queryFn: () => fetchRetentionReview(month),
    placeholderData: keepPreviousData,
  })
}

/** The page's batch save: the month's changed rows in one call, all or nothing. */
export function useSaveReviewSessions(month: string, feedback: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (entries: readonly SessionEntryInput[]) => recordMonthlySessions(month, entries),
    onSuccess: async (_, entries) => {
      void queryClient.invalidateQueries({ queryKey: professionalKeys.compensations() })
      for (const entry of entries) void refreshProfessionalHistory(queryClient, entry.professionalId)
      await queryClient.invalidateQueries({ queryKey: professionalKeys.reviews() })
      toast.success(t(`${R}.saved`, { count: String(entries.length) }))
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: professionalKeys.review(month) })
      showMutationError(queryClient, error, feedback)
    },
  })
}

// --- The clinic's terms (Paramètres → Rémunération) ------------------------------------------------

const kindsQuery = queryOptions({ queryKey: compensationTermsKeys.kinds(), queryFn: fetchCompensationKinds, staleTime: Infinity })

/** The other kinds, read once per session (a global catalogue changed by migration). */
export function useCompensationKinds(enabled = true) {
  return useQuery({ ...kindsQuery, enabled })
}

export function useCompensationTerms() {
  return useQuery({ queryKey: compensationTermsKeys.terms(), queryFn: fetchCompensationTerms })
}

/**
 * A change to the clinic's grids or rates: the terms are refetched (awaited), and so is every
 * professional's entry and review (what is suggested follows the grids), in the background.
 * Refusals go to the dialog; the terms are refetched then too (another admin may have changed them).
 */
function useClinicTermsMutation<V>(mutationFn: (variables: V) => Promise<void>, successMessage: string, feedback: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: professionalKeys.compensations() })
      void queryClient.invalidateQueries({ queryKey: professionalKeys.reviews() })
      await queryClient.invalidateQueries({ queryKey: compensationTermsKeys.terms() })
      toast.success(successMessage)
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: compensationTermsKeys.terms() })
      showMutationError(queryClient, error, feedback)
    },
  })
}

export function useSetCompensationRate(feedback: MutationFeedback) {
  return useClinicTermsMutation((input: RateInput) => setCompensationRate(input), t(`${S}.rates.saved`), feedback)
}

export function useDeleteCompensationRate(feedback: MutationFeedback) {
  return useClinicTermsMutation((id: string) => deleteCompensationRate(id), t(`${S}.rates.deleted`), feedback)
}

export function useSetRetentionGrid(feedback: MutationFeedback) {
  return useClinicTermsMutation((input: GridInput) => setRetentionGrid(input), t(`${S}.grids.saved`), feedback)
}

export function useDeleteRetentionGrid(feedback: MutationFeedback) {
  return useClinicTermsMutation((id: string) => deleteRetentionGrid(id), t(`${S}.grids.deleted`), feedback)
}
