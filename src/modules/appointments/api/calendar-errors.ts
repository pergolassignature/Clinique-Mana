import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'

const E = 'modules.appointments.calendar.errors'

/**
 * The codes whose meaning is the Google busy-time functions' own (R6): the clinic's Google
 * application not set, Google not answering, the return link from Google spent, expired or forged,
 * nothing connected.
 */
const OVERRIDES = {
  not_configured: () => t(`${E}.notConfigured`),
  provider_error: () => t(`${E}.providerError`),
  link_invalid: () => t(`${E}.linkInvalid`),
  link_expired: () => t(`${E}.linkExpired`),
  link_used: () => t(`${E}.linkUsed`),
  not_found: () => t(`${E}.notFound`),
  forbidden: () => t(`${E}.forbidden`),
} as const

/**
 * The French text of a failed Google busy-time call or RPC: a refusal as written (« La permission
 * de voir vos disponibilités… », « Cet agenda Google est déjà connecté… »), a 429 with its delay,
 * the module's or the shared text of a known code. Anything else is reported (code only).
 */
export function calendarErrorMessage(error: unknown, fallback = t('common.errors.generic')): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, fallback, 'appointments')
  const text = functionErrorText(error, { overrides: OVERRIDES, audience: 'professional' })
  if (text !== null) return text
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'appointments', code: error.code } })
  return fallback
}
