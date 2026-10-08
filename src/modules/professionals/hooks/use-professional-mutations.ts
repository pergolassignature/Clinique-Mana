import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
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
  syncProfessionalSignin,
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
   * licence, the gender (the title's form, P4-342), the sets, new clients, readiness). Default:
   * yes. Bio, approach, public contact, IVAC, experience, phone and address do not: the lists are
   * not refetched for them.
   */
  touchesList?: (variables: V) => boolean
  /** Other queries the change shows in (the gender: the title's form in Rémunération and the review, P4-342). */
  alsoRefetch?: (variables: V) => readonly (readonly unknown[])[]
  successMessage?: string
  /** Says the outcome in place of `successMessage` (the status changes: the account's sign-in, P4-381). */
  notify?: (result: R, variables: V, queryClient: QueryClient) => void
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
        ...(config.alsoRefetch?.(variables) ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ])
      if (config.notify) config.notify(result, variables, queryClient)
      else toast.success(config.successMessage ?? t('modules.professionals.toasts.saved'))
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

/** The columns of `professionals` a patch can change that the list shows (gender: the title's form). */
const LIST_FIELDS = ['firstName', 'lastName', 'gender'] as const satisfies readonly (keyof ProfessionalPatch)[]
const never = () => false

export function useUpdateProfessional(feedback?: MutationFeedback) {
  return useRecordMutation(
    {
      mutationFn: ({ id, patch }: { id: string; patch: ProfessionalPatch }) => updateProfessional(id, patch),
      apply: (record, _, { patch }) => ({ ...record, professional: { ...record.professional, ...patch } }),
      touchesUsage: false,
      touchesList: ({ patch }) => LIST_FIELDS.some((field) => field in patch),
      alsoRefetch: ({ id, patch }) => ('gender' in patch ? [professionalKeys.compensation(id), professionalKeys.reviews()] : []),
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

const S = 'modules.professionals.toasts.signin'

/**
 * Auth refused the ban (or the unban) after the status change (P4-381): a warning that stays until
 * closed, with « Réessayer » (`sync_signin`: the ban made to follow the account's status). A retry
 * that fails again shows it again; one that succeeds says so. It runs even if the dialog or the
 * page has closed meanwhile.
 */
function signinWarning(queryClient: QueryClient, id: string, change: 'disabled' | 'enabled'): void {
  const retry = (): void => {
    syncProfessionalSignin(id).then(
      ({ accountStatus, signinSynced }) => {
        if (!signinSynced) signinWarning(queryClient, id, accountStatus === 'active' ? 'enabled' : 'disabled')
        else if (accountStatus === 'disabled') toast.success(t(`${S}.blocked`))
        else if (accountStatus === 'active') toast.success(t(`${S}.restored`))
        else toast.success(t(`${S}.noAccount`))
      },
      (error: unknown) => showMutationError(queryClient, error, undefined),
    )
  }
  toast.warning(t(change === 'disabled' ? `${S}.notBlocked` : `${S}.notRestored`), {
    duration: Infinity,
    action: { label: t('common.retry'), onClick: retry },
  })
}

/** The status change's toast: the account's part said when it changed (P4-113, P4-381). */
function statusToast(change: StatusChange, id: string, queryClient: QueryClient, plain: string): void {
  if (change.accountChange !== null && !change.signinSynced) signinWarning(queryClient, id, change.accountChange)
  else if (change.accountChange === 'disabled') toast.success(t(`${S}.deactivatedClosed`))
  else if (change.accountChange === 'enabled') toast.success(t(`${S}.reactivatedOpen`))
  else toast.success(plain)
}

/**
 * Resolves with the status change (`accountChange`: the provider's account was re-enabled, its
 * sign-in ban lifted unless `signinSynced` is false).
 */
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
      notify: (change, { id }, queryClient) => statusToast(change, id, queryClient, t('modules.professionals.toasts.activated')),
    },
    feedback,
  )
}

/**
 * Resolves with the status change (`accountChange: 'disabled'` when the reason disables the
 * account: its open sessions ended, new sign-ins banned unless `signinSynced` is false).
 */
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
      notify: (change, { id }, queryClient) => statusToast(change, id, queryClient, t('modules.professionals.toasts.deactivated')),
    },
    feedback,
  )
}
