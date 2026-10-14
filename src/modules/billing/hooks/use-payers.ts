import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  createPayerInvoice,
  fetchClientPayersBilling,
  fetchPayerOrganisations,
  fetchPayerQueue,
  fetchPayerSettings,
  preparePayerInvoices,
  savePayerOrganisation,
  setClientPayerOrganisation,
  setIvacRate,
  type OrganisationInput,
} from '../api/payers'
import { billingError } from '../lib/errors'
import type { MutationFeedback } from './use-invoices'
import { billingKeys } from './keys'

export const usePayerQueue = () => useQuery({ queryKey: billingKeys.payerQueue(), queryFn: fetchPayerQueue })
export const usePayerOrganisations = (options: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: billingKeys.payerOrganisations(), queryFn: fetchPayerOrganisations, enabled: options.enabled ?? true })
export const usePayerSettings = () => useQuery({ queryKey: billingKeys.payerSettings(), queryFn: fetchPayerSettings })
export const useClientPayersBilling = (clientId: string) =>
  useQuery({ queryKey: billingKeys.clientPayers(clientId), queryFn: () => fetchClientPayersBilling(clientId), enabled: clientId !== '' })

/** Every write invalidates `billingKeys.all`: a payer invoice moves « Payeurs », the dossier and the lists together. */
function usePayerMutation<V, R>(mutationFn: (variables: V) => Promise<R>, successKey: TranslationKey | null, feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: billingKeys.all })
      if (successKey) toast.success(t(successKey))
    },
    onError: (error) => {
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      const message = billingError(error)
      if (feedback?.onErrorMessage) feedback.onErrorMessage(message)
      else toast.error(message)
    },
  })
}

const S = 'modules.billing.payers.saved'

export const useSavePayerOrganisation = (feedback?: MutationFeedback) =>
  usePayerMutation((input: OrganisationInput) => savePayerOrganisation(input), `${S}.organisation`, feedback)
export const useSetIvacRate = (feedback?: MutationFeedback) =>
  usePayerMutation(
    ({ effectiveFrom, sessionCents }: { effectiveFrom: string; sessionCents: number }) => setIvacRate(effectiveFrom, sessionCents),
    `${S}.rate`,
    feedback,
  )
export const useSetClientPayerOrganisation = (feedback?: MutationFeedback) =>
  usePayerMutation(
    ({ clientPayerId, organisationId }: { clientPayerId: string; organisationId: string | null }) => setClientPayerOrganisation(clientPayerId, organisationId),
    `${S}.clientOrganisation`,
    feedback,
  )

/**
 * « Préparer les factures » (null: every organisation, by its cadence) or « Facturer les PAE »
 * (`closing`, once per PAE organisation given: IVAC is never closed). Resolves with the drafts made.
 */
export const usePreparePayerInvoices = (feedback?: MutationFeedback) =>
  usePayerMutation(
    async ({ organisationIds, closing }: { organisationIds: readonly (string | null)[]; closing: boolean }) => {
      const made: string[] = []
      for (const id of organisationIds) made.push(...(await preparePayerInvoices(id, closing)))
      return made
    },
    null,
    feedback,
  )

/** A payer invoice by hand (a report billed to IVAC): resolves with the draft's id. */
export const useCreatePayerInvoice = (feedback?: MutationFeedback) =>
  usePayerMutation((clientPayerId: string) => createPayerInvoice(clientPayerId), `${S}.created`, feedback)
