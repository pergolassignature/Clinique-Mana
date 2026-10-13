import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  addAdjustment,
  createInvoice,
  createManualInvoice,
  deleteDraft,
  fetchBillingNames,
  fetchClientBilling,
  fetchInvoice,
  fetchInvoices,
  fetchSequence,
  finalizeInvoice,
  INVOICES_PAGE,
  issueCreditNote,
  removeLine,
  setDefaultPayer,
  setInvoiceNotes,
  setInvoicePayer,
  setLinePrice,
  setSequence,
  type AdjustmentInput,
  type InvoiceStatus,
} from '../api/invoices'
import { billingError } from '../lib/errors'
import { billingKeys } from './keys'

export function useInvoices(status: InvoiceStatus | null) {
  return useInfiniteQuery({
    queryKey: billingKeys.invoices(status),
    queryFn: ({ pageParam }) => fetchInvoices(status, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length === INVOICES_PAGE ? (last.at(-1)?.createdAt ?? null) : null),
  })
}

export const useInvoice = (id: string) => useQuery({ queryKey: billingKeys.invoice(id), queryFn: () => fetchInvoice(id), enabled: id !== '' })
export const useClientBilling = (clientId: string) =>
  useQuery({ queryKey: billingKeys.client(clientId), queryFn: () => fetchClientBilling(clientId), enabled: clientId !== '' })
export const useBillingNames = () => useQuery({ queryKey: billingKeys.names(), queryFn: fetchBillingNames, staleTime: 5 * 60_000 })
export const useSequence = (year: number) => useQuery({ queryKey: billingKeys.sequence(year), queryFn: () => fetchSequence(year) })

/** Where a failure is shown: in the form (the message), else a toast. */
export interface MutationFeedback {
  onErrorMessage?: (message: string) => void
}

function useBillingMutation<V, R>(mutationFn: (variables: V) => Promise<R>, successKey: TranslationKey | null, feedback?: MutationFeedback) {
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

const S = 'modules.billing.saved'

export const useCreateInvoice = (feedback?: MutationFeedback) => useBillingMutation((ids: string[]) => createInvoice(ids), `${S}.created`, feedback)
export const useCreateManualInvoice = (feedback?: MutationFeedback) => useBillingMutation((clientId: string) => createManualInvoice(clientId), `${S}.created`, feedback)
export const useAddAdjustment = (feedback?: MutationFeedback) => useBillingMutation((input: AdjustmentInput) => addAdjustment(input), `${S}.lineAdded`, feedback)
export const useSetLinePrice = (feedback?: MutationFeedback) =>
  useBillingMutation(({ lineId, cents }: { lineId: string; cents: number }) => setLinePrice(lineId, cents), `${S}.price`, feedback)
export const useRemoveLine = (feedback?: MutationFeedback) => useBillingMutation((lineId: string) => removeLine(lineId), `${S}.lineRemoved`, feedback)
export const useSetInvoicePayer = (feedback?: MutationFeedback) =>
  useBillingMutation(({ invoiceId, payerId }: { invoiceId: string; payerId: string }) => setInvoicePayer(invoiceId, payerId), `${S}.payer`, feedback)
export const useSetInvoiceNotes = (feedback?: MutationFeedback) =>
  useBillingMutation(
    ({ invoiceId, notesClient, notesInternal }: { invoiceId: string; notesClient: string | null; notesInternal: string | null }) =>
      setInvoiceNotes(invoiceId, notesClient, notesInternal),
    `${S}.notes`,
    feedback,
  )
export const useDeleteDraft = (feedback?: MutationFeedback) => useBillingMutation((invoiceId: string) => deleteDraft(invoiceId), `${S}.deleted`, feedback)
export const useFinalizeInvoice = (feedback?: MutationFeedback) => useBillingMutation((invoiceId: string) => finalizeInvoice(invoiceId), null, feedback)
export const useIssueCreditNote = (feedback?: MutationFeedback) =>
  useBillingMutation(({ invoiceId, reason }: { invoiceId: string; reason: string }) => issueCreditNote(invoiceId, reason), `${S}.credited`, feedback)
export const useSetDefaultPayer = (feedback?: MutationFeedback) =>
  useBillingMutation(({ clientId, payerId }: { clientId: string; payerId: string }) => setDefaultPayer(clientId, payerId), `${S}.defaultPayer`, feedback)
export const useSetSequence = (feedback?: MutationFeedback) =>
  useBillingMutation(({ year, lastNumber }: { year: number; lastNumber: number }) => setSequence(year, lastNumber), `${S}.sequence`, feedback)
