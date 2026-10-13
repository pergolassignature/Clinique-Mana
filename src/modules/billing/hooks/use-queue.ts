import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  createStatement,
  deliverNow,
  fetchBillingSettings,
  fetchMorningQueue,
  holdDraft,
  recordPayment,
  releaseDraft,
  resendDocument,
  sendInvoices,
  setQueueFrom,
  setSpecialAgreement,
  type DocumentKind,
  type PaymentInput,
  type SendResult,
  type StatementInput,
} from '../api/queue'
import { billingError } from '../lib/errors'
import type { MutationFeedback } from './use-invoices'
import { billingKeys } from './keys'

export const useMorningQueue = () => useQuery({ queryKey: billingKeys.queue(), queryFn: fetchMorningQueue })
export const useBillingSettings = () => useQuery({ queryKey: billingKeys.settings(), queryFn: fetchBillingSettings })

/**
 * Renders and sends what was just queued (`billing-documents` « deliver »), then refreshes the
 * screens. Best effort: a failure here is the job's (every 5 minutes), never the user's.
 */
function deliverSoon(queryClient: QueryClient): void {
  void deliverNow()
    .catch(() => undefined)
    .finally(() => void queryClient.invalidateQueries({ queryKey: billingKeys.all }))
}

function useQueueMutation<V, R>(
  mutationFn: (variables: V) => Promise<R>,
  options: { successKey?: TranslationKey; deliver?: boolean; feedback?: MutationFeedback },
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: billingKeys.all })
      if (options.deliver) deliverSoon(queryClient)
      if (options.successKey) toast.success(t(options.successKey))
    },
    onError: (error) => {
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      const message = billingError(error)
      if (options.feedback?.onErrorMessage) options.feedback.onErrorMessage(message)
      else toast.error(message)
    },
  })
}

const S = 'modules.billing.saved'

/** « Envoyer » / « Tout envoyer »: the results per invoice (the caller says what went and what did not). */
export const useSendInvoices = (feedback?: MutationFeedback) =>
  useQueueMutation((ids: string[]): Promise<SendResult[]> => sendInvoices(ids), { deliver: true, feedback })
export const useHoldDraft = (feedback?: MutationFeedback) =>
  useQueueMutation(({ invoiceId, note }: { invoiceId: string; note: string | null }) => holdDraft(invoiceId, note), { successKey: `${S}.held`, feedback })
export const useReleaseDraft = (feedback?: MutationFeedback) =>
  useQueueMutation((invoiceId: string) => releaseDraft(invoiceId), { successKey: `${S}.released`, feedback })
export const useResendDocument = (feedback?: MutationFeedback) =>
  useQueueMutation(({ kind, id }: { kind: DocumentKind; id: string }) => resendDocument(kind, id), { successKey: `${S}.resent`, deliver: true, feedback })
export const useRecordPayment = (feedback?: MutationFeedback) =>
  useQueueMutation((input: PaymentInput) => recordPayment(input), { successKey: `${S}.payment`, deliver: true, feedback })
export const useCreateStatement = (feedback?: MutationFeedback) =>
  useQueueMutation((input: StatementInput) => createStatement(input), { deliver: true, feedback })
export const useSetSpecialAgreement = (feedback?: MutationFeedback) =>
  useQueueMutation(({ clientId, note }: { clientId: string; note: string | null }) => setSpecialAgreement(clientId, note), {
    successKey: `${S}.agreement`,
    feedback,
  })
export const useSetQueueFrom = (feedback?: MutationFeedback) =>
  useQueueMutation((day: string | null) => setQueueFrom(day), { successKey: `${S}.queueFrom`, feedback })
