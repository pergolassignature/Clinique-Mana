import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { functionErrorText } from '@/core/supabase/function-errors'
import { toast } from '@/shared/ui/sonner'
import { fetchMyConsentSignatures, startMyConsentSignature } from '../api/my-consents'
import { consentKeys } from './keys'

const M = 'modules.clients.mine.consents'

/** The client consents waiting for the signed-in professional (CC-22). */
export function useMyConsentSignatures() {
  return useQuery({ queryKey: consentKeys.mine(), queryFn: fetchMyConsentSignatures })
}

/**
 * Her signing link for one consent. The answer is a credential, so it is never put in the cache:
 * the caller keeps it in component state (`gcTime: 0`, as « Ne jamais mettre en cache » asks).
 */
export function useStartMyConsentSignature() {
  const queryClient = useQueryClient()
  return useMutation({
    gcTime: 0,
    mutationFn: (requestId: string) => startMyConsentSignature(requestId),
    onSuccess: (link) => {
      // The client has not signed yet: say so and refresh the list's state.
      if (!link) {
        toast.info(t(`${M}.waitingClient`))
        return queryClient.invalidateQueries({ queryKey: consentKeys.mine() })
      }
    },
    // `audience: 'professional'`: she is never sent to Paramètres and never reads « Documenso ».
    onError: (error) =>
      toast.error(
        functionErrorText(error, { service: 'signing', audience: 'professional' }) ??
          moduleErrorMessage(error, t(`${M}.signError`), 'clients'),
      ),
  })
}

/** Called once she has signed: the webhook completes the request, so the list is refetched. */
export function useRefreshMyConsentSignatures() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: consentKeys.mine() })
}
