import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'

/** A failed Demandes call in French: a P0001 refusal as written, else the module's generic text. */
export function demandesError(error: unknown): string {
  return moduleErrorMessage(error, t('modules.demandes.errors.failed'), 'demandes')
}
