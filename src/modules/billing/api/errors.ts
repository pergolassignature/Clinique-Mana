import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'

/**
 * The codes whose meaning is the QuickBooks functions' own: the clinic's Intuit application not
 * set, Intuit not answering, Intuit's return spent, expired or forged, no connection, a refresh
 * refused (« Reconnecter »).
 */
const OVERRIDES = {
  not_configured: () => t('modules.billing.errors.notConfigured'),
  provider_error: () => t('modules.billing.errors.providerError'),
  link_invalid: () => t('modules.billing.errors.linkInvalid'),
  link_expired: () => t('modules.billing.errors.linkExpired'),
  link_used: () => t('modules.billing.errors.linkUsed'),
  not_found: () => t('modules.billing.errors.notConnected'),
  conflict: () => t('modules.billing.errors.needsReconnect'),
  rate_limited: () => t('modules.billing.errors.rateLimited'),
} as const

/**
 * The French text of a failed QuickBooks call or module RPC: a refusal passed on as written, a
 * 429 with its delay, the module's or the shared text of a known code. Anything else is reported
 * (code only: the functions' messages carry no token) and reads as the generic text.
 */
export function billingErrorMessage(error: unknown, fallback = t('common.errors.generic')): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, fallback)
  const text = functionErrorText(error, { overrides: OVERRIDES })
  if (text !== null) return text
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'billing', code: error.code } })
  return fallback
}
