import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'

const E = 'modules.billing.payroll.errors'

/**
 * The French text of a failed payroll call (an RPC or `billing-payout-invoice`): a P0001 refusal
 * as written (« Cette période de paie est verrouillée. »), a 429 with its delay, the shared text
 * of a known code; anything else is reported (code only) and reads as the payroll's generic text.
 * A failed upload of her invoice reads `uploadErrorMessage` (`@/core/storage/errors`).
 */
export function payrollErrorMessage(error: unknown): string {
  const fallback = t(`${E}.failed`)
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, fallback, 'billing')
  const text = functionErrorText(error, { audience: 'professional' })
  if (text !== null) return text
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'billing', code: error.code } })
  return fallback
}
