import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError, refusalMessage } from '@/core/supabase/functions'
import { retryInText } from '@/shared/lib/retry-after'

/** The codes that have their own French text (`settings.signing.errors.<code>`); not reported. */
const KNOWN = new Set(['not_configured', 'provider_error', 'conflict', 'not_found', 'unauthenticated', 'network'] as const)
type KnownCode = typeof KNOWN extends Set<infer C> ? C : never
const isKnown = (code: string): code is KnownCode => (KNOWN as Set<string>).has(code)

/**
 * The French text of a failed signing function call (`signing-test-connection`,
 * `signing-test-document`, `signing-sync`; P3-28): a database refusal's French message as is
 * (400 `invalid_request`), a 429 with its delay, its own text for each known code. Anything else
 * is reported (code and message only: the functions' messages carry no address, key or URL) and
 * reads as the generic text. An RPC error goes through `moduleErrorMessage`.
 */
export function signingErrorMessage(error: unknown): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, t('common.errors.generic'), 'settings')
  const refusal = refusalMessage(error)
  if (refusal !== null) return refusal
  if (error.code === 'rate_limited') return `${t('settings.signing.errors.rate_limited')} ${retryInText(error.retryAfter)}`
  if (error.code === 'forbidden') return t('common.errors.forbidden')
  if (isKnown(error.code)) return t(`settings.signing.errors.${error.code}`)
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'settings', code: error.code } })
  return t('common.errors.generic')
}
