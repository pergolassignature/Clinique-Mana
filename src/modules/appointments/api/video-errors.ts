import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'

const E = 'modules.appointments.video.errors'

/**
 * The codes whose meaning is the Zoom functions' own (C-4): the clinic's Zoom app not set, Zoom
 * not answering, the return link from Zoom spent, expired or forged, nothing connected.
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
 * The French text of a failed Zoom call (`zoom-connect`, `zoom-callback`) or video RPC: a refusal
 * as written (« Zoom a refusé… », « Ce compte Zoom est déjà connecté… »), a 429 with its delay,
 * the module's or the shared text of a known code. Anything else is reported (code only) and
 * reads as the generic text.
 */
export function videoErrorMessage(error: unknown, fallback = t('common.errors.generic')): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, fallback, 'appointments')
  const text = functionErrorText(error, { overrides: OVERRIDES, audience: 'professional' })
  if (text !== null) return text
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'appointments', code: error.code } })
  return fallback
}
