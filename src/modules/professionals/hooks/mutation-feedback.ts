import type { QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { professionalCatalogKeys } from './keys'

/** Options every mutation hook of the module takes. */
export interface MutationFeedback {
  /**
   * Shows the failure where the user acts (under a field, in a dialog) instead of a toast. Called
   * once per failure with the user-facing message (the error is reported to Sentry once).
   */
  onErrorMessage?: (message: string, error: unknown) => void
}

/**
 * A failed mutation: `P0001` shown as is, `42501` as the generic refusal (and the caller's access
 * and the catalogue refetched: their rights changed elsewhere), anything else as « L'enregistrement n'a pas
 * fonctionné » and reported (`moduleErrorMessage`, area `professionals`).
 */
export function showMutationError(queryClient: QueryClient, error: unknown, feedback: MutationFeedback | undefined): void {
  if (rpcErrorCode(error) === '42501') {
    void queryClient.invalidateQueries({ queryKey: accessKeys.all })
    // The catalogue (nine empty lists without a professionals permission) and the usage counts
    // follow the caller's rights too.
    void queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.all })
  }
  const message = moduleErrorMessage(error, t('modules.professionals.errors.saveFailed'), 'professionals')
  if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
  else toast.error(message)
}
