import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'
import { toast } from '@/shared/ui/sonner'
import { fetchMyImageConsent, startConsentSigning, syncMyConsent, type SigningLink, type SigningReturn } from '../api/consent-sign'
import { professionalKeys } from './keys'

const S = 'modules.professionals.consentSign'

/** Her consent step (states and dates only). */
export function useMyImageConsent(enabled = true) {
  return useQuery({ queryKey: professionalKeys.myImageConsent(), queryFn: fetchMyImageConsent, enabled })
}

/**
 * The French text of a failed « Signer » (P3-28): a refusal as written, else as every feature
 * says the code to a professional (`functionErrorText`, C-4: never « Documenso », never Paramètres).
 */
function consentSignErrorMessage(error: unknown): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, t(`${S}.errors.generic`), 'professionals')
  const text = functionErrorText(error, {
    service: 'signing',
    audience: 'professional',
    overrides: { conflict: () => t(`${S}.errors.inProgress`), rate_limited: () => t(`${S}.errors.rateLimited`) },
  })
  return text ?? t(`${S}.errors.generic`)
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
  // Plain state, not a mutation: the return from the signing page starts it from an effect, and its
  // « Vérification… » must end with the request whatever React does with the effect.
  const [checking, setChecking] = useState(false)

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

  const completed = useCallback(() => {
    setLink(null)
    setChecking(true)
    syncMyConsent()
      .then((outcome) => {
        if (outcome === 'signed') toast.success(t(`${S}.signedToast`))
        else toast.info(t(`${S}.pendingCheck`))
      })
      .catch(() => toast.info(t(`${S}.pendingCheck`)))
      .finally(() => {
        setChecking(false)
        void refresh()
      })
  }, [refresh])

  return {
    link,
    error,
    opening: start.isPending,
    checking,
    open,
    completed,
    close: useCallback(() => setLink(null), []),
  }
}
