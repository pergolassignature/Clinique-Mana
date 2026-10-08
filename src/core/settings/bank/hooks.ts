import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { fetchBankDetails, revealAccountNumber, setBankDetails, type BankDetailsInput } from './api'

export const bankKeys = {
  all: ['bank-details'] as const,
  details: () => [...bankKeys.all, 'details'] as const,
}

/** How long a revealed account number stays on screen. */
export const REVEAL_DURATION_MS = 60_000

/** The masked bank details (null when none are stored). The full account number is never cached. */
export function useBankDetails() {
  // Fresh for a minute: a background refetch must not re-sync the form while someone is typing.
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
 * The full account number, revealed on demand. Each `reveal` calls the RPC, which writes an audit
 * row. The number lives in this component's state only (never in React Query) and is dropped by
 * `hide`, after `REVEAL_DURATION_MS`, and on unmount. An answer that arrives after `hide` or after
 * unmount is ignored. A refusal is a toast; nothing stored any more refreshes the masked details.
 */
export function useRevealedAccountNumber() {
  const queryClient = useQueryClient()
  const [accountNumber, setAccountNumber] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Bumped by every reveal, hide and unmount: an answer for an older request is dropped.
  const request = useRef(0)

  useEffect(
    () => () => {
      request.current += 1
      clearTimeout(timer.current)
    },
    [],
  )

  const hide = useCallback(() => {
    request.current += 1
    clearTimeout(timer.current)
    setAccountNumber(null)
    setPending(false)
  }, [])

  const reveal = useCallback(async () => {
    const id = ++request.current
    clearTimeout(timer.current)
    setPending(true)
    try {
      const number = await revealAccountNumber()
      if (id !== request.current) return
      setAccountNumber(number)
      if (number === null) {
        void queryClient.invalidateQueries({ queryKey: bankKeys.all })
      } else {
        timer.current = setTimeout(hide, REVEAL_DURATION_MS)
      }
    } catch (error) {
      if (id !== request.current) return
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    } finally {
      if (id === request.current) setPending(false)
    }
  }, [hide, queryClient])

  return { accountNumber, pending, reveal, hide }
}
