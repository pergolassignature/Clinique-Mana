import type { QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { professionalCatalogKeys, professionalKeys } from './keys'

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
 * and the catalogue refetched: their rights changed elsewhere), `40001` as « Le dossier vient de
 * changer. » (the professionals refetched, not reported), anything else as « L'enregistrement n'a
 * pas fonctionné » and reported (`moduleErrorMessage`, area `professionals`).
 */
export function showMutationError(queryClient: QueryClient, error: unknown, feedback: MutationFeedback | undefined): void {
  const code = rpcErrorCode(error)
  if (code === '42501') {
    void queryClient.invalidateQueries({ queryKey: accessKeys.all })
    // The catalogue (nine empty lists without a professionals permission) and the usage counts
    // follow the caller's rights too.
    void queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.all })
  }
  // `40001`: the status RPCs found the account linked or unlinked between their read and their lock
  // (`lock_professional_with_account`). Expected under concurrency: shown, refetched, never reported.
  if (code === '40001') void queryClient.invalidateQueries({ queryKey: professionalKeys.all })
  const message =
    code === '40001' ? t('modules.professionals.errors.recordChanged') : moduleErrorMessage(error, t('modules.professionals.errors.saveFailed'), 'professionals')
  if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
  else toast.error(message)
}
