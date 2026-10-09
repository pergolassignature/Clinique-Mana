import type { QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { retryInText } from '@/shared/lib/retry-after'
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

const E = 'modules.professionals.onboarding.errors'

/**
 * The French text of a module function's failure that is not the database's (P3-28): a sending
 * limit (with when to retry), the module switched off, the connection, an expired session, the
 * service unavailable. Null for anything else (a refusal passed on is an RPC error, `asRpcRefusal`).
 * These are expected: shown, never reported.
 */
export function functionErrorMessage(error: unknown): string | null {
  if (!(error instanceof FunctionCallError)) return null
  switch (error.code) {
    case 'rate_limited':
      return `${t(`${E}.rateLimited`)} ${retryInText(error.retryAfter)}`
    case 'module_disabled':
      return t(`${E}.moduleDisabled`)
    case 'network':
      return t(`${E}.network`)
    case 'unauthenticated':
      return t(`${E}.unauthenticated`)
    case 'not_configured':
    case 'auth_unavailable':
      return t(`${E}.unavailable`)
    default:
      return null
  }
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
  // A module function's own failure (the status function, the invitations): said plainly, not reported.
  const message =
    functionErrorMessage(error) ??
    (code === '40001' ? t('modules.professionals.errors.recordChanged') : moduleErrorMessage(error, t('modules.professionals.errors.saveFailed'), 'professionals'))
  if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
  else toast.error(message)
}
