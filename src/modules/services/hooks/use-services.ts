import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  addBillingPolicy,
  addRateVariant,
  deleteBillingPolicy,
  endRateVariant,
  fetchServicePrices,
  fetchServicesSettings,
  saveService,
  setServiceActive,
  setServiceTitles,
  type PolicyInput,
  type ServiceInput,
  type VariantInput,
} from '../api/catalogue'
import { setServiceExclusions } from '../api/offered'
import { serviceKeys } from './keys'
import { taxRateOn } from '@/core/settings/tax/api'
import type { TaxRatesOn } from '../lib/taxes'

const S = 'modules.services.settings'

/** Options every mutation hook of the module takes. */
export interface MutationFeedback {
  /** Shows the failure where the user acts (in a sheet or a dialog) instead of a toast; called once per failure. */
  onErrorMessage?: (message: string, error: unknown) => void
}

/**
 * A failed mutation: `P0001` shown as is, `42501` as the generic refusal (and the caller's access
 * refetched: their rights changed elsewhere), anything else as « L'enregistrement n'a pas
 * fonctionné » and reported (`moduleErrorMessage`, area `services`).
 */
export function showMutationError(queryClient: ReturnType<typeof useQueryClient>, error: unknown, feedback: MutationFeedback | undefined): void {
  if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
  const message = moduleErrorMessage(error, t('modules.services.errors.saveFailed'), 'services')
  if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
  else toast.error(message)
}

/** The settings section's bundle (the catalogue changes rarely: fresh for 5 minutes). */
export function useServicesSettings() {
  return useQuery({ queryKey: serviceKeys.settings(), queryFn: fetchServicesSettings, staleTime: 5 * 60_000 })
}

/**
 * Every price of the active catalogue on `on` (the clinic's date). Always refetched on mount: the
 * grids change in Paramètres → Rémunération, which does not invalidate this module's keys.
 */
export function useServicePrices(on: string) {
  return useQuery({ queryKey: serviceKeys.prices(on), queryFn: () => fetchServicePrices(on), staleTime: 0 })
}

/** The GST and QST in force on `on` (null where none): « Prix »'s after-tax preview. */
export function useTaxRatesOn(on: string) {
  return useQuery({
    queryKey: serviceKeys.taxRates(on),
    queryFn: async (): Promise<TaxRatesOn> => {
      const [gst, qst] = await Promise.all([taxRateOn('gst', on), taxRateOn('qst', on)])
      return { gst, qst }
    },
  })
}

/**
 * A write of the module: on success everything of the module is refetched (awaited, so a sheet
 * closes onto fresh data) and the toast says what was done; a refusal goes where the user acts,
 * and the bundle is refetched too (someone else may have changed it).
 */
function useServicesMutation<V, R>(mutationFn: (variables: V) => Promise<R>, success: (result: R, variables: V) => string, feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async (result, variables) => {
      await queryClient.invalidateQueries({ queryKey: serviceKeys.all })
      toast.success(success(result, variables))
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.settings() })
      showMutationError(queryClient, error, feedback)
    },
  })
}

/** « Enregistrer » of the service sheet: the service, then its titles when they changed. */
export function useSaveService(feedback?: MutationFeedback) {
  return useServicesMutation(
    async ({ input, titleIds }: { input: ServiceInput; titleIds: readonly string[] | null }) => {
      const id = await saveService(input)
      if (titleIds !== null) await setServiceTitles(id, titleIds)
      return id
    },
    (_, { input }) => t(input.id === null ? `${S}.catalogue.created` : `${S}.catalogue.saved`),
    feedback,
  )
}

export function useSetServiceActive(feedback?: MutationFeedback) {
  return useServicesMutation(
    ({ id, active }: { id: string; active: boolean }) => setServiceActive(id, active),
    (_, { active }) => t(active ? `${S}.catalogue.restored` : `${S}.catalogue.archivedToast`),
    feedback,
  )
}

export function useAddRateVariant(feedback?: MutationFeedback) {
  return useServicesMutation((input: VariantInput) => addRateVariant(input), () => t(`${S}.variants.saved`), feedback)
}

export function useEndRateVariant(feedback?: MutationFeedback) {
  return useServicesMutation(
    ({ id, effectiveTo }: { id: string; effectiveTo: string | null }) => endRateVariant(id, effectiveTo),
    (_, { effectiveTo }) => t(effectiveTo === null ? `${S}.variants.deleted` : `${S}.variants.ended`),
    feedback,
  )
}

export function useAddBillingPolicy(feedback?: MutationFeedback) {
  return useServicesMutation((input: PolicyInput) => addBillingPolicy(input), () => t(`${S}.policy.saved`), feedback)
}

export function useDeleteBillingPolicy(feedback?: MutationFeedback) {
  return useServicesMutation((id: string) => deleteBillingPolicy(id), () => t(`${S}.policy.deleted`), feedback)
}

/** R-83: « Services offerts » saved (the services of her titles she does not offer). */
export function useSetServiceExclusions(feedback?: MutationFeedback) {
  return useServicesMutation(
    ({ professionalId, serviceIds }: { professionalId: string; serviceIds: readonly string[] }) => setServiceExclusions(professionalId, serviceIds),
    () => t('modules.services.offered.saved'),
    feedback,
  )
}
