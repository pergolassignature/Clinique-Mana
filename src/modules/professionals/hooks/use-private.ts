import { useEffect, useRef, useState } from 'react'
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { useRevealedValue } from '@/shared/lib/use-revealed-value'
import { toast } from '@/shared/ui/sonner'
import {
  clearProfessionalPrivateField,
  fetchProfessionalPrivate,
  revealProfessionalPrivate,
  setProfessionalBank,
  setProfessionalSin,
  setProfessionalTaxNumbers,
  type BankInput,
  type PrivateField,
  type TaxNumbersInput,
} from '../api/private'
import { professionalKeys } from './keys'
import { showMutationError } from './mutation-feedback'
import { refreshProfessionalHistory } from './use-professional-record'

const C = 'modules.professionals.record.compensation'

/** The masked private data. A revealed value never goes in here (`useRevealedPrivateValue`). */
const privateQuery = (id: string) => queryOptions({ queryKey: professionalKeys.private(id), queryFn: () => fetchProfessionalPrivate(id) })

/** Needs `professionals.private`: pass `enabled` from `can`, so nobody else sends a request bound to fail. */
export function useProfessionalPrivate(id: string, enabled: boolean) {
  return useQuery({ ...privateQuery(id), enabled: enabled && id !== '' })
}

/** On the tab's hover or focus: the masks only, never a reveal. */
export function prefetchProfessionalPrivate(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(privateQuery(id))
}

/**
 * A refusal as the private cards show it: the message, and the HINT when it is a sentence for the
 * user (« Retirez le numéro de compte enregistré, ou saisissez-le de nouveau… », P4-142). A HINT
 * shaped like an identifier (`stale`) routes the refusal and is never shown.
 */
export interface Refusal {
  message: string
  detail: string | null
  /** HINT `stale`: the masks are being refetched; the next save may use them (`useExpectedVersion`). */
  stale: boolean
}

const ROUTING_HINT = /^[a-z_]+$/

/** The HINT of a refusal when it is written for the user, else null. */
export function readableHint(error: unknown): string | null {
  const hint = rpcErrorHint(error)
  return rpcErrorCode(error) === 'P0001' && hint !== undefined && !ROUTING_HINT.test(hint) ? hint : null
}

/** HINT `stale` (P4-148): another save happened since the card read the row. */
export const isStale = (error: unknown) => rpcErrorCode(error) === 'P0001' && rpcErrorHint(error) === 'stale'

/**
 * Turns a failed private RPC into what a card shows, once per failure (Sentry gets a generic
 * failure once, never a value: the RPCs' messages never repeat one). A stale save reads « Ces
 * renseignements ont été modifiés entre-temps… » and refetches the masks; the typed values stay in
 * the form.
 */
function usePrivateRefusal(id: string, action: 'save' | 'reveal') {
  const queryClient = useQueryClient()
  return (error: unknown): Refusal => {
    if (isStale(error)) {
      void queryClient.invalidateQueries({ queryKey: professionalKeys.private(id) })
      return { message: t(`${C}.stale`), detail: null, stale: true }
    }
    if (action === 'reveal') {
      // The caller's rights changed elsewhere: the access refetch hides the card.
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      return { message: moduleErrorMessage(error, t('common.errors.generic'), 'professionals'), detail: readableHint(error), stale: false }
    }
    let message = ''
    showMutationError(queryClient, error, { onErrorMessage: (text) => (message = text) })
    return { message, detail: readableHint(error), stale: false }
  }
}

/**
 * One card's save (P4-148): its own RPC with the `updated_at` the card read. On success the masks
 * and the history's first page are refetched (awaited, so the card closes onto fresh data). The
 * mutation keeps no variables once settled (`gcTime: 0`): a typed account or SIN never stays in
 * React Query.
 */
function usePrivateMutation<V>(id: string, mutationFn: (variables: V) => Promise<unknown>, successMessage: string, onRefusal: (refusal: Refusal) => void) {
  const queryClient = useQueryClient()
  const refusal = usePrivateRefusal(id, 'save')
  return useMutation({
    mutationFn,
    gcTime: 0,
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: professionalKeys.private(id) }), refreshProfessionalHistory(queryClient, id)])
      toast.success(successMessage)
    },
    onError: (error) => onRefusal(refusal(error)),
  })
}

/**
 * The `updated_at` a card sends as `p_expected_updated_at` (P4-148): the version the person was
 * looking at when they started editing. While the form is clean it follows the masks (a refetch is
 * what they now see); once they type, a background refetch (window focus) no longer moves it, so
 * another person's save in between is refused (`stale`) rather than silently overwritten. After a
 * stale refusal (`acceptLatest`) the refetched version is taken: the card has said « Vérifiez-les,
 * puis enregistrez de nouveau ».
 */
export function useExpectedVersion(updatedAt: string | null, dirty: boolean) {
  const base = useRef(updatedAt)
  const resync = useRef(false)
  useEffect(() => {
    if (!dirty || resync.current) {
      base.current = updatedAt
      resync.current = false
    }
  }, [dirty, updatedAt])
  return {
    expected: () => base.current,
    acceptLatest: () => {
      resync.current = true
    },
  }
}

interface Expected {
  /** `updated_at` as `get_professional_private` returned it (null when nothing is stored). */
  expectedUpdatedAt: string | null
}

export function useSaveTaxNumbers(id: string, onRefusal: (refusal: Refusal) => void) {
  return usePrivateMutation(
    id,
    ({ input, expectedUpdatedAt }: { input: TaxNumbersInput } & Expected) => setProfessionalTaxNumbers(id, input, expectedUpdatedAt),
    t(`${C}.taxNumbers.saved`),
    onRefusal,
  )
}

export function useSaveBank(id: string, onRefusal: (refusal: Refusal) => void) {
  return usePrivateMutation(
    id,
    ({ input, expectedUpdatedAt }: { input: BankInput } & Expected) => setProfessionalBank(id, input, expectedUpdatedAt),
    t(`${C}.bank.saved`),
    onRefusal,
  )
}

export function useSaveSin(id: string, onRefusal: (refusal: Refusal) => void) {
  return usePrivateMutation(
    id,
    ({ sin, expectedUpdatedAt }: { sin: string } & Expected) => setProfessionalSin(id, sin, expectedUpdatedAt),
    t(`${C}.sin.saved`),
    onRefusal,
  )
}

/** « Retirer »: no expected value (removing is never a lost update, P4-148). */
export function useClearPrivateField(id: string, field: PrivateField, onRefusal: (refusal: Refusal) => void) {
  return usePrivateMutation(id, () => clearProfessionalPrivateField(id, field), t(field === 'sin' ? `${C}.sin.removed` : `${C}.bank.removed`), onRefusal)
}

/**
 * The SIN or the account number, revealed on demand (« Afficher »): audited by the RPC, kept in
 * this component's state only and dropped after 60 s, when the browser tab is hidden and on
 * unmount (leaving the record tab or the page). A refusal stays next to the value, with its
 * readable HINT (an unreadable kept value says how to fix it, P4-142). Nothing stored any more
 * refetches the masks. Each reveal marks the history stale (it gains « a affiché … »). A new
 * `version` (the row's `updated_at`: any private save or removal, here or elsewhere) masks the
 * value again, so a revealed value never outlives the row it was read from.
 */
export function useRevealedPrivateValue(id: string, field: PrivateField, version: string | null) {
  const queryClient = useQueryClient()
  const describe = usePrivateRefusal(id, 'reveal')
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const revealed = useRevealedValue({
    fetchValue: async () => {
      const value = await revealProfessionalPrivate(id, field)
      void refreshProfessionalHistory(queryClient, id)
      return value
    },
    onNothing: () => void queryClient.invalidateQueries({ queryKey: professionalKeys.private(id) }),
    onError: (error) => setRefusal(describe(error)),
  })
  const { hide } = revealed
  useEffect(() => hide(), [hide, version])
  const reveal = () => {
    setRefusal(null)
    return revealed.reveal()
  }
  return { value: revealed.value, pending: revealed.pending, reveal, hide: revealed.hide, refusal }
}
