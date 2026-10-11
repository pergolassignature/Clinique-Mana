import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'

/**
 * The codes whose meaning is the signing settings' own (C-4): here `not_configured` answers a test
 * of the settings being edited, so it says what to check; the shared texts cover the others.
 */
const OVERRIDES = {
  not_configured: () => t('settings.signing.errors.not_configured'),
  conflict: () => t('settings.signing.errors.conflict'),
  not_found: () => t('settings.signing.errors.not_found'),
  rate_limited: () => t('settings.signing.errors.rate_limited'),
} as const

/**
 * The French text of a failed signing function call (`signing-test-connection`,
 * `signing-test-document`, `signing-sync`; P3-28): a database refusal's French message as is
 * (400 `invalid_request`), a 429 with its delay, the shared text of each known code
 * (`functionErrorText`) unless the settings mean something else by it. Anything else
 * is reported (code and message only: the functions' messages carry no address, key or URL) and
 * reads as the generic text. An RPC error goes through `moduleErrorMessage`.
 */
export function signingErrorMessage(error: unknown): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, t('common.errors.generic'), 'settings')
  const text = functionErrorText(error, { service: 'signing', overrides: OVERRIDES })
  if (text !== null) return text
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'settings', code: error.code } })
  return t('common.errors.generic')
}
