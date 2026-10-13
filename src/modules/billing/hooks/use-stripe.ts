import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addInteracNotice,
  chargeNow,
  fetchClientStripe,
  ignoreInteracNotice,
  listInteracNotices,
  matchInteracNotice,
  removeCard,
  sendCardLink,
  type NewNotice,
  type NoticeState,
} from '../api/stripe'

/**
 * Query keys of Stripe and Interac (FS), under the module's root (`['billing']`). A card or a
 * charge changes a dossier's invoices too, and a matched notice records a payment: every write
 * invalidates the whole module root, so the invoices, the dossier's panel and the lists follow.
 */
export const stripeKeys = {
  all: ['billing', 'stripe'] as const,
  client: (clientId: string) => [...stripeKeys.all, 'client', clientId] as const,
  notices: (status: NoticeState) => [...stripeKeys.all, 'interac', status] as const,
}

export function useClientStripe(clientId: string) {
  return useQuery({ queryKey: stripeKeys.client(clientId), queryFn: () => fetchClientStripe(clientId) })
}

export function useInteracNotices(status: NoticeState) {
  return useQuery({ queryKey: stripeKeys.notices(status), queryFn: () => listInteracNotices(status) })
}

function useBillingMutation<A, R>(fn: (args: A) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['billing'] }),
  })
}

export const useSendCardLink = () => useBillingMutation((payerClientId: string) => sendCardLink(payerClientId))
export const useChargeNow = () => useBillingMutation((invoiceId: string) => chargeNow(invoiceId))
export const useRemoveCard = () => useBillingMutation((payerClientId: string) => removeCard(payerClientId))
export const useAddInteracNotice = () => useBillingMutation((input: NewNotice) => addInteracNotice(input))
export const useMatchInteracNotice = () =>
  useBillingMutation(({ noticeId, invoiceId }: { noticeId: string; invoiceId: string }) => matchInteracNotice(noticeId, invoiceId))
export const useIgnoreInteracNotice = () =>
  useBillingMutation(({ noticeId, reason }: { noticeId: string; reason: string }) => ignoreInteracNotice(noticeId, reason))
