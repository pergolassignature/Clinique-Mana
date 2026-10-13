import { t } from '@/i18n'
import { FunctionCallError, refusalMessage } from '@/core/supabase/functions'
import { moduleErrorMessage } from '@/core/modules/errors'

/** A failed Demandes call in French: a P0001 refusal as written, else the module's generic text. */
export function demandesError(error: unknown): string {
  return moduleErrorMessage(error, t('modules.demandes.errors.failed'), 'demandes')
}

/** A function's refusal in French (`demandes-propose`), the rate limit, or the generic message. */
export function proposeErrorMessage(error: unknown): string {
  if (error instanceof FunctionCallError) {
    if (error.code === 'rate_limited') return t('modules.demandes.propositions.rateLimited')
    return refusalMessage(error) ?? t('modules.demandes.errors.failed')
  }
  return demandesError(error)
}
