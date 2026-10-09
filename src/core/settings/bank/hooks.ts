import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { REVEAL_DURATION_MS, useRevealedValue } from '@/shared/lib/use-revealed-value'
import { toast } from '@/shared/ui/sonner'
import { fetchBankDetails, revealAccountNumber, setBankDetails, type BankDetailsInput } from './api'

export const bankKeys = {
  all: ['bank-details'] as const,
  details: () => [...bankKeys.all, 'details'] as const,
}

/** How long a revealed account number stays on screen (shared with every reveal). */
export { REVEAL_DURATION_MS }

/** The masked bank details (null when none are stored). The full account number is never cached. */
export function useBankDetails() {
  // Fresh for a minute, like the organization: switching sections or windows does not call the RPC
  // again each time. A refetch while editing is harmless: the form keeps what is typed.
  return useQuery({ queryKey: bankKeys.details(), queryFn: fetchBankDetails, staleTime: 60_000 })
}

/**
 * Saves the bank details. Stays pending until the fresh masked row is in the cache, so the form
 * closes onto the saved values. The toasts live in the mutation options so the outcome shows even
 * if the page unmounts first.
 *
 * `gcTime: 0`: the mutation's variables hold the typed account number; once the form is gone,
 * nothing in React Query keeps it.
 */
export function useSetBankDetails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BankDetailsInput) => setBankDetails(input),
    gcTime: 0,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bankKeys.all })
      toast.success(t('settings.bank.saved'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}

/**
 * The full account number, revealed on demand (`useRevealedValue`): each `reveal` calls the RPC,
 * which writes an audit row; the number lives in this component's state only (never in React
 * Query) and is dropped by `hide`, after `REVEAL_DURATION_MS`, when the tab is hidden, and on
 * unmount. A refusal is a toast; nothing stored any more refreshes the masked details.
 */
export function useRevealedAccountNumber() {
  const queryClient = useQueryClient()
  const { value, pending, reveal, hide } = useRevealedValue({
    fetchValue: revealAccountNumber,
    onNothing: () => void queryClient.invalidateQueries({ queryKey: bankKeys.all }),
    onError: (error) => toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings')),
  })
  return { accountNumber: value, pending, reveal, hide }
}
