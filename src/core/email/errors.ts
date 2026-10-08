import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { EmailFunctionError } from './api'
import { UNCLOSED_BRACES_MESSAGE } from './schemas'

/** The codes that have their own French text (`settings.email.errors.<code>`); not reported. */
const KNOWN = new Set(['not_configured', 'rate_limited', 'provider_error', 'module_disabled', 'not_found', 'unauthenticated', 'network'] as const)
type KnownCode = typeof KNOWN extends Set<infer C> ? C : never
const isKnown = (code: string): code is KnownCode => (KNOWN as Set<string>).has(code)

/**
 * `email-test-send`'s answer when the provider refused the recipient (`invalid_recipient` → 400
 * `invalid_request`, message « Invalid recipient »). The test goes to the caller's own address.
 */
const INVALID_RECIPIENT_MESSAGE = 'Invalid recipient'

/**
 * The French text of a failed email function call (`email-preview`, `email-test-send`; P3-28).
 * The function's English message is never shown, except SQL's unclosed-braces sentence, which it
 * sends as is; an unknown placeholder names its `variable`. Unexpected codes go to Sentry (code and
 * message only: the functions' messages carry no address or value) and read as the generic text.
 */
export function emailErrorMessage(error: unknown): string {
  if (error instanceof EmailFunctionError) {
    const { code, status, message, variable } = error
    if (code === 'invalid_request') {
      if (variable !== undefined) return t('settings.email.validation.unknownVariable', { variable: `{{${variable}}}` })
      if (message === UNCLOSED_BRACES_MESSAGE) return message
      if (message === INVALID_RECIPIENT_MESSAGE) return t('settings.email.errors.invalidRecipient')
      return status === 413 ? t('settings.email.errors.tooLarge') : t('settings.email.errors.invalid_request')
    }
    if (code === 'forbidden') return t('common.errors.forbidden')
    if (isKnown(code)) return t(`settings.email.errors.${code}`)
  }
  const code = error instanceof EmailFunctionError ? error.code : 'unknown'
  const report = new Error(error instanceof Error ? error.message : String(error))
  report.name = `EmailFunctionError ${code}`
  Sentry.captureException(report, { tags: { area: 'settings', code } })
  return t('common.errors.generic')
}
