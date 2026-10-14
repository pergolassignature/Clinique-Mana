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

/**
 * « Bill annulé dans QuickBooks » (`qbo-bill-check`, BI-28): the refusals as written (« Le Bill
 * existe toujours dans QuickBooks : supprimez-le d'abord. »), then what keeps QuickBooks from
 * answering, in plain words; anything else as `payrollErrorMessage`.
 */
export function qboBillErrorMessage(error: unknown): string {
  if (!(error instanceof FunctionCallError)) return payrollErrorMessage(error)
  const text = functionErrorText(error, {
    overrides: {
      not_found: () => t(`${E}.qboBill.notConnected`),
      conflict: () => t(`${E}.qboBill.reconnect`),
      not_configured: () => t(`${E}.qboBill.notConfigured`),
      provider_error: () => t(`${E}.qboBill.unreachable`),
    },
  })
  return text ?? payrollErrorMessage(error)
}
