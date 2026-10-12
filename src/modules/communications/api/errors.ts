import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'

/**
 * The codes whose meaning is the Gmail functions' own (C-4): the clinic's Google application not
 * set, Google not answering, the return link from Google spent, expired or forged, a mailbox gone.
 */
const OVERRIDES = {
  not_configured: () => t('modules.communications.errors.notConfigured'),
  provider_error: () => t('modules.communications.errors.providerError'),
  link_invalid: () => t('modules.communications.errors.linkInvalid'),
  link_expired: () => t('modules.communications.errors.linkExpired'),
  link_used: () => t('modules.communications.errors.linkUsed'),
  not_found: () => t('modules.communications.errors.notFound'),
  rate_limited: () => t('modules.communications.errors.rateLimited'),
} as const

/**
 * The French text of a failed Gmail call (`gmail-connect`, `gmail-callback`, `gmail-sync`) or
 * module RPC: a refusal passed on as written (« Google a refusé le code… »), a 429 with its delay,
 * the module's or the shared text of a known code. Anything else is reported (code only: the
 * functions' messages carry no address or token) and reads as the generic text.
 */
export function communicationsErrorMessage(error: unknown, fallback = t('common.errors.generic')): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, fallback)
  const text = functionErrorText(error, { overrides: OVERRIDES })
  if (text !== null) return text
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'communications', code: error.code } })
  return fallback
}
