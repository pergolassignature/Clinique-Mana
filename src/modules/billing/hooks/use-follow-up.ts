import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { decideFee, fetchFeeDecisions, fetchOverdueInvoices, refundPayment, setDunning, type DunningInput, type FeeStatus } from '../api/follow-up'
import { billingError } from '../lib/errors'
import type { MutationFeedback } from './use-invoices'
import { billingKeys } from './keys'

export const useOverdueInvoices = () => useQuery({ queryKey: billingKeys.overdue(), queryFn: fetchOverdueInvoices })
export const useFeeDecisions = (status: FeeStatus | null) =>
  useQuery({ queryKey: billingKeys.fees(status), queryFn: () => fetchFeeDecisions(status) })

function useFollowUpMutation<V, R>(mutationFn: (variables: V) => Promise<R>, successKey: TranslationKey | null, feedback?: MutationFeedback) {
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

/** « Appliquer les frais » (a draft in the morning queue) / « Ne pas facturer ». */
export const useDecideFee = (feedback?: MutationFeedback) =>
  useFollowUpMutation(({ appointmentId, apply, note }: { appointmentId: string; apply: boolean; note: string | null }) => decideFee(appointmentId, apply, note), null, feedback)
export const useRefundPayment = (feedback?: MutationFeedback) =>
  useFollowUpMutation(({ paymentId, amountCents, reason }: { paymentId: string; amountCents: number; reason: string }) => refundPayment(paymentId, amountCents, reason), `${S}.refund`, feedback)
export const useSetDunning = (feedback?: MutationFeedback) => useFollowUpMutation((input: DunningInput) => setDunning(input), `${S}.dunning`, feedback)
