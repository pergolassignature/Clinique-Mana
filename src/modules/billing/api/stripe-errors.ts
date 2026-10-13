import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'

const E = 'modules.billing.stripe.errors'

/** The codes whose meaning is the Stripe functions' own (C-4). */
const OVERRIDES = {
  not_configured: () => t(`${E}.notConfigured`),
  provider_error: () => t(`${E}.providerError`),
  conflict: () => t(`${E}.reserved`),
} as const

/**
 * The French text of a failed Stripe or Interac call: a refusal as written (« Ce payeur n'a pas
 * d'adresse courriel… »), a 429 with its delay, Stripe not set or not answering, the module
 * reserved for its testers; anything else is reported (code only) and reads as the generic text.
 */
export function stripeErrorMessage(error: unknown): string {
  const fallback = t(`${E}.failed`)
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, fallback, 'billing')
  const text = functionErrorText(error, { overrides: OVERRIDES })
  if (text !== null) return text
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'billing', code: error.code } })
  return fallback
}
