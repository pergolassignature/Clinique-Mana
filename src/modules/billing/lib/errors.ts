import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'

/** A failed Facturation call in French: a P0001 refusal as written, else the module's generic text. */
export function billingError(error: unknown): string {
  return moduleErrorMessage(error, t('modules.billing.errors.failed'), 'billing')
}
