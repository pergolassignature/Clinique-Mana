import { useMutation, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import {
  activateProfessional,
  createProfessional,
  deactivateProfessional,
  setClienteles,
  setLanguages,
  setMotifs,
  setPayerNumber,
  setProfessionalEmail,
  setProfessions,
  setSpecialties,
  updateMatchingProfile,
  updateProfessional,
  updatePublicProfile,
  type MatchingProfilePatch,
  type NewProfessional,
  type ProfessionalPatch,
  type ProfessionInput,
  type PublicProfilePatch,
} from '../api/record'
import type { ProfessionalRecord, SpecializedRef, StatusChange } from '../api/parse'
import type { PayerType } from '../lib/constants'
import { professionalCatalogKeys, professionalKeys } from './keys'
import { refreshProfessionalHistory } from './use-professional-record'
import { showMutationError, type MutationFeedback } from './mutation-feedback'

/**
 * One hook per record change. On success: the RPC's result is written into the cached record
 * (the new set, the merged fields, the new status), then the record and the history of that
 * professional are refetched, the lists when the change shows there (sets and status also the
 * usage counts, see `keys.ts`),
 * awaited so the mutation settles on fresh data; then « Modifications enregistrées. ». No
 * optimistic write: the database decides (licence rules, restricted motifs…), and a refusal
 * leaves the cache untouched. Failures: `showMutationError` (toast, or `onErrorMessage`).
 */

interface RecordMutation<V extends { id: string }, R> {
  mutationFn: (variables: V) => Promise<R>
  /** The record with the result written in (before the refetch confirms it). */
  apply: (record: ProfessionalRecord, result: R, variables: V) => ProfessionalRecord
  /** Sets and status change « Utilisé par » in the settings lists. */
  touchesUsage: boolean
  /**
   * Whether the change shows in the list (`LIST_COLUMNS`: names, email, status, primary title and
   * licence, the sets, new clients, readiness). Default: yes. Bio, approach, public contact, IVAC,
   * experience, gender, phone and address do not: the lists are not refetched for them.
   */
  touchesList?: (variables: V) => boolean
  successMessage?: string
}

function useRecordMutation<V extends { id: string }, R>(config: RecordMutation<V, R>, feedback: MutationFeedback | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: config.mutationFn,
    onSuccess: async (result, variables) => {
      queryClient.setQueryData<ProfessionalRecord | null>(professionalKeys.record(variables.id), (record) =>
        record ? config.apply(record, result, variables) : record,
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: professionalKeys.record(variables.id) }),
        (config.touchesList?.(variables) ?? true) && queryClient.invalidateQueries({ queryKey: professionalKeys.lists() }),
        refreshProfessionalHistory(queryClient, variables.id),
        config.touchesUsage && queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.usage() }),
      ])
      toast.success(config.successMessage ?? t('modules.professionals.toasts.saved'))
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
  })
}

// --- Creation ------------------------------------------------------------------------------------

/**
 * « Créer »: resolves with the new id as soon as the record exists (the dialog navigates to it);
 * the lists and the usage counts are refetched behind it, not awaited: the record page does not
 * show them, and a slow list must not hold the dialog open.
 */
export function useCreateProfessional(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NewProfessional) => createProfessional(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: professionalKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.usage() })
      toast.success(t('modules.professionals.toasts.created'))
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
  })
}

// --- Plain fields --------------------------------------------------------------------------------

/** The columns of `professionals` a patch can change that the list shows. */
const LIST_FIELDS = ['firstName', 'lastName'] as const satisfies readonly (keyof ProfessionalPatch)[]
const never = () => false

export function useUpdateProfessional(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, patch }: { id: string; patch: ProfessionalPatch }) => updateProfessional(id, patch),
      apply: (record, _, { patch }) => ({ ...record, professional: { ...record.professional, ...patch } }),
      touchesUsage: false,
      touchesList: ({ patch }) => LIST_FIELDS.some((field) => field in patch),
    },
    feedback,
  )
}

export function useUpdatePublicProfile(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, patch }: { id: string; patch: PublicProfilePatch }) => updatePublicProfile(id, patch),
      apply: (record, _, { patch }) => ({ ...record, publicProfile: { ...record.publicProfile, ...patch } }),
      touchesUsage: false,
      touchesList: never,
    },
    feedback,
  )
}

export function useUpdateMatchingProfile(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, patch }: { id: string; patch: MatchingProfilePatch }) => updateMatchingProfile(id, patch),
      apply: (record, _, { patch }) => ({ ...record, matchingProfile: { ...record.matchingProfile, ...patch } }),
      touchesUsage: false,
      touchesList: ({ patch }) => 'acceptingNewClients' in patch,
    },
    feedback,
  )
}

export function useSetProfessionalEmail(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, email }: { id: string; email: string }) => setProfessionalEmail(id, email),
      apply: (record, _, { email }) => ({ ...record, professional: { ...record.professional, email } }),
      touchesUsage: false,
    },
    feedback,
  )
}

// --- Sets ----------------------------------------------------------------------------------------

export function useSetProfessions(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, items }: { id: string; items: ProfessionInput[] }) => setProfessions(id, items),
      apply: (record, professions) => ({ ...record, professions }),
      touchesUsage: true,
    },
    feedback,
  )
}

export function useSetClienteles(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, items }: { id: string; items: SpecializedRef[] }) => setClienteles(id, items),
      apply: (record, clienteles) => ({ ...record, clienteles }),
      touchesUsage: true,
    },
    feedback,
  )
}

export function useSetSpecialties(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, items }: { id: string; items: SpecializedRef[] }) => setSpecialties(id, items),
      apply: (record, specialties) => ({ ...record, specialties }),
      touchesUsage: true,
    },
    feedback,
  )
}

export function useSetMotifs(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, motifIds }: { id: string; motifIds: string[] }) => setMotifs(id, motifIds),
      apply: (record, motifIds) => ({ ...record, motifIds }),
      touchesUsage: true,
    },
    feedback,
  )
}

export function useSetLanguages(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, languageIds }: { id: string; languageIds: string[] }) => setLanguages(id, languageIds),
      apply: (record, languageIds) => ({ ...record, languageIds }),
      touchesUsage: true,
    },
    feedback,
  )
}

/** IVAC number; `number` null deletes it. */
export function useSetPayerNumber(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, type, number }: { id: string; type: PayerType; number: string | null }) => setPayerNumber(id, type, number),
      apply: (record, _, { type, number }) => ({
        ...record,
        payerNumbers: [...record.payerNumbers.filter((p) => p.type !== type), ...(number ? [{ type, number }] : [])],
      }),
      touchesUsage: false,
      touchesList: never,
    },
    feedback,
  )
}

// --- Status --------------------------------------------------------------------------------------

/** The RPCs trim notes and reasons this way (`btrim(…, E' \t\r\n')`, empty → null). */
const trimmed = (text: string | null | undefined) => text?.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') || null

/**
 * The record after a status change, as the RPCs write it: activation clears the deactivation
 * reason, note and account claim (and keeps an override reason only for an incomplete file);
 * deactivation sets the reason and note, clears the override reason, and claims the account
 * when it disabled it.
 */
const withStatus = (record: ProfessionalRecord, change: StatusChange, fields: Partial<ProfessionalRecord['professional']>): ProfessionalRecord => ({
  ...record,
  professional: { ...record.professional, ...fields, status: change.status },
})

/** Resolves with the status change (`accountChange`: the provider's account was re-enabled). */
export function useActivateProfessional(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, overrideReason }: { id: string; overrideReason?: string }) => activateProfessional(id, overrideReason),
      apply: (record, change, { overrideReason }) =>
        withStatus(record, change, {
          deactivationReasonId: null,
          deactivationNote: null,
          deactivationDisabledAccount: false,
          activationOverrideReason: record.readiness.complete ? null : trimmed(overrideReason),
        }),
      touchesUsage: true,
      successMessage: t('modules.professionals.toasts.activated'),
    },
    feedback,
  )
}

/** Resolves with the status change (`accountChange: 'disabled'` when the reason disables the account). */
export function useDeactivateProfessional(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, reasonId, note }: { id: string; reasonId: string; note?: string | null }) => deactivateProfessional(id, reasonId, note),
      apply: (record, change, { reasonId, note }) =>
        withStatus(record, change, {
          deactivationReasonId: reasonId,
          deactivationNote: trimmed(note),
          deactivationDisabledAccount: change.accountChange === 'disabled',
          activationOverrideReason: null,
        }),
      touchesUsage: true,
      successMessage: t('modules.professionals.toasts.deactivated'),
    },
    feedback,
  )
}
