import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { EmailFunctionError } from './api'
import { UNCLOSED_BRACES_MESSAGE } from './schemas'
import { functionErrorText } from '@/core/supabase/function-errors'

/** The codes whose meaning is the template editor's own (the shared texts cover the others, C-4). */
const OVERRIDES = {
  not_found: () => t('settings.email.errors.not_found'),
} as const

/**
 * `email-test-send`'s answer when the provider refused the recipient (`invalid_recipient` → 400
 * `invalid_request`, message « Invalid recipient »). The test goes to the caller's own address.
 */
const INVALID_RECIPIENT_MESSAGE = 'Invalid recipient'

/**
 * The French text of a failed email function call (`email-preview`, `email-test-send`; P3-28).
 * The function's English message is never shown, except SQL's unclosed-braces sentence, which it
 * sends as is; an unknown placeholder names its `variable`; every other known code reads as
 * everywhere (`functionErrorText`, a 429 with when to retry). Unexpected codes go to Sentry (code and
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
    const text = functionErrorText(error, { service: 'email', overrides: OVERRIDES })
    if (text !== null) return text
  }
  const code = error instanceof EmailFunctionError ? error.code : 'unknown'
  const report = new Error(error instanceof Error ? error.message : String(error))
  report.name = `EmailFunctionError ${code}`
  Sentry.captureException(report, { tags: { area: 'settings', code } })
  return t('common.errors.generic')
}
