import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { decideFee, fetchFeeDecisions, fetchOverdueInvoices, recordRefundOutsideApp, refundPayment, setDunning, type DunningInput, type FeeStatus } from '../api/follow-up'
import { refundByStripe, type StripeRefundStatus } from '../api/stripe'
import { billingError } from '../lib/errors'
import type { MutationFeedback } from './use-invoices'
import { billingKeys } from './keys'

export const useOverdueInvoices = () => useQuery({ queryKey: billingKeys.overdue(), queryFn: fetchOverdueInvoices })
export const useFeeDecisions = (status: FeeStatus | null, enabled = true) =>
  useQuery({ queryKey: billingKeys.fees(status), queryFn: () => fetchFeeDecisions(status), enabled })

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
/**
 * « Rembourser » (F3's `refund_payment`). A Stripe payment's refund is then made at Stripe at once
 * (FS-9): its toast says what Stripe did; a call that fails leaves it « En attente » for the job.
 */
export const useRefundPayment = (feedback?: MutationFeedback) =>
  useFollowUpMutation(
    async ({ paymentId, amountCents, reason, modeCode }: { paymentId: string; amountCents: number; reason: string; modeCode: string }) => {
      const refundId = await refundPayment(paymentId, amountCents, reason)
      if (modeCode !== 'stripe') {
        toast.success(t(`${S}.refund`))
        return
      }
      const status: StripeRefundStatus = await refundByStripe(refundId).catch(() => 'pending' as const)
      if (status === 'failed') toast.error(t(`${S}.refundStripe.failed`))
      else toast.success(t(status === 'pending' ? `${S}.refundStripe.pending` : `${S}.refundStripe.recorded`))
    },
    null,
    feedback,
  )
/** « Remboursement fait hors de l'app » (BI-29): an imported card payment, recorded with its reference. */
export const useRecordRefundOutsideApp = (feedback?: MutationFeedback) =>
  useFollowUpMutation(
    ({ paymentId, amountCents, reason, reference }: { paymentId: string; amountCents: number; reason: string; reference: string }) =>
      recordRefundOutsideApp(paymentId, amountCents, reason, reference),
    `${S}.refund`,
    feedback,
  )
export const useSetDunning = (feedback?: MutationFeedback) => useFollowUpMutation((input: DunningInput) => setDunning(input), `${S}.dunning`, feedback)
