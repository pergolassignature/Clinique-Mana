import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { retryInText } from '@/shared/lib/retry-after'
import { toast } from '@/shared/ui/sonner'
import { fetchMyImageConsent, startConsentSigning, syncMyConsent, type SigningLink, type SigningReturn } from '../api/consent-sign'
import { professionalKeys } from './keys'

const S = 'modules.professionals.consentSign'

/** Her consent step (states and dates only). */
export function useMyImageConsent(enabled = true) {
  return useQuery({ queryKey: professionalKeys.myImageConsent(), queryFn: fetchMyImageConsent, enabled })
}

/** The French text of a failed « Signer » (P3-28): a refusal as written, else by code. */
export function consentSignErrorMessage(error: unknown): string {
  if (rpcErrorCode(error) === 'P0001') return moduleErrorMessage(error, t(`${S}.errors.generic`), 'professionals')
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, t(`${S}.errors.generic`), 'professionals')
  switch (error.code) {
    case 'provider_error':
      return t(`${S}.errors.provider`)
    case 'not_configured':
      return t(`${S}.errors.notConfigured`)
    case 'conflict':
      return t(`${S}.errors.inProgress`)
    case 'rate_limited':
      return `${t(`${S}.errors.rateLimited`)} ${retryInText(error.retryAfter)}`
    case 'network':
      return t(`${S}.errors.network`)
    default:
      return t(`${S}.errors.generic`)
  }
}

/**
 * « Signer le consentement » and what follows (P4-487, P4-488). `open()` asks the function for her
 * signing link with one idempotency key kept until it succeeds (a retry after a failure that may
 * have sent something is the same request); the link — a credential — lives in this hook's state
 * only (the mutation is reset at once, `gcTime: 0`: nothing in React Query) and is dropped once she
 * signed or closed it. `completed()` (the embed's `onDocumentCompleted`, or back from the signing
 * page) syncs with Documenso at once and refetches her step, « Mes documents » and the
 * questionnaire; the webhook completes it anyway.
 */
export function useConsentSigning(back: SigningReturn) {
  const queryClient = useQueryClient()
  const key = useRef<string | null>(null)
  const [link, setLink] = useState<SigningLink | null>(null)
  const [error, setError] = useState<string | null>(null)
  const start = useMutation({ mutationFn: (idempotencyKey: string) => startConsentSigning(idempotencyKey, back), gcTime: 0 })
  const { mutateAsync, reset } = start
  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: professionalKeys.myImageConsent() }),
        queryClient.invalidateQueries({ queryKey: professionalKeys.myDocuments() }),
        queryClient.invalidateQueries({ queryKey: professionalKeys.mySubmission() }),
      ]),
    [queryClient],
  )
  const sync = useMutation({
    mutationFn: syncMyConsent,
    onSuccess: (outcome) => {
      if (outcome === 'signed') toast.success(t(`${S}.signedToast`))
      else toast.info(t(`${S}.pendingCheck`))
    },
    onError: () => toast.info(t(`${S}.pendingCheck`)),
    onSettled: () => refresh(),
  })

  const open = useCallback(async () => {
    setError(null)
    key.current ??= crypto.randomUUID()
    try {
      const next = await mutateAsync(key.current)
      key.current = null
      setLink(next)
    } catch (failure) {
      // A refusal wrote nothing: the next try draws a new key.
      if (rpcErrorCode(failure) === 'P0001') key.current = null
      setError(consentSignErrorMessage(failure))
    } finally {
      reset()
    }
  }, [mutateAsync, reset])

  const { mutate: runSync } = sync
  const completed = useCallback(() => {
    setLink(null)
    runSync()
  }, [runSync])

  return {
    link,
    error,
    opening: start.isPending,
    checking: sync.isPending,
    open,
    completed,
    close: useCallback(() => setLink(null), []),
  }
}
