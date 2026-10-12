import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { functionErrorText } from '@/core/supabase/function-errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { smsErrorText } from './sms-status'

const S = 'modules.communications.sms'

/** The PBX's failure code `sms-send` returns with a 502 / 503 (`error.extra.code`), if any. */
export function smsSendFailureCode(error: unknown): string | null {
  if (!(error instanceof FunctionCallError)) return null
  const inner = error.extra.extra
  if (typeof inner !== 'object' || inner === null) return null
  const code = (inner as Record<string, unknown>).code
  return typeof code === 'string' ? code : null
}

/**
 * The French text of a failed `sms-send` (a reply or a test): a refusal as written (no consent, a
 * number that cannot be read), a limit with its delay, the PBX's failure by its code (« La centrale
 * téléphonique a refusé ce numéro. »), the settings gap (« Paramètres → Textos »). `failed` is the
 * sentence the PBX's reason completes (« Le texto n'est pas parti. … »). Anything else is
 * reported (code and message only) and reads `fallback`. An RPC error goes through
 * `moduleErrorMessage`.
 */
export function smsSendErrorMessage(error: unknown, { failed, fallback }: { failed: 'composer.failed' | 'settings.send.testFailed'; fallback: string }): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, fallback, 'communications')
  const reason = smsErrorText(smsSendFailureCode(error))
  const text = functionErrorText(error, {
    overrides: {
      rate_limited: () => t(`${S}.composer.rateLimited`),
      not_configured: () => t(`${S}.composer.notConfigured`),
      provider_error: () => t(`${S}.${failed}`, { reason }),
    },
  })
  if (text !== null) return text
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'communications', code: error.code } })
  return fallback
}
