import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { functionErrorText } from '@/core/supabase/function-errors'
import { retryInText } from '@/shared/lib/retry-after'
import { UploadSendError } from './api'

/** The codes whose meaning is the upload's own (C-4); the shared texts cover the others. */
const OVERRIDES = {
  // storage-confirm: no pending upload of the caller's (older than 24 h, or the permission is gone).
  not_found: () => t('storage.errors.expired'),
  // storage-confirm: a concurrent call settled the file otherwise.
  conflict: () => t('storage.errors.conflict'),
  rate_limited: () => t('storage.errors.rateLimited'),
} as const

/** The generic text, after reporting the code and the function's message (no name, path or value). */
function reported(error: FunctionCallError): string {
  const report = new Error(error.message)
  report.name = `FunctionCallError ${error.code}`
  Sentry.captureException(report, { tags: { area: 'storage', code: error.code } })
  return t('common.errors.generic')
}

/**
 * A failed send to the signed path. With a status, storage's status is reported (the status
 * alone: no path, name or token). A 4xx means storage refused the upload itself (its one-time
 * token expired or was used, a body it would not take): the file is to be chosen again. A 5xx,
 * or no status (the network, not reported), gets the connection text.
 */
function sendErrorMessage(error: UploadSendError): string {
  if (error.status === null) return t('storage.errors.sendFailed')
  const report = new Error('Upload to the signed path failed')
  report.name = `UploadSendError ${error.status}`
  Sentry.captureException(report, { tags: { area: 'storage', status: String(error.status) } })
  return error.status >= 400 && error.status < 500 ? t('storage.errors.sendRefused') : t('storage.errors.sendFailed')
}

/**
 * The French text of a failed upload (`uploadFile`, then `set_org_asset`): the functions'
 * French refusal as is (too large, wrong type, not received, image too large…); a 429 with its
 * delay, never retried; its own text for an expired or settled upload and a failed or refused
 * send (`sendErrorMessage`), the shared text for every other known code (`functionErrorText`). An RPC error goes
 * through `moduleErrorMessage`; anything else is the generic text, reported.
 */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof UploadSendError) return sendErrorMessage(error)
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, t('common.errors.generic'), 'storage')
  return functionErrorText(error, { overrides: OVERRIDES }) ?? reported(error)
}

/**
 * Why a preview has no URL (`storage-sign`): a 429 with its delay; otherwise it is unavailable
 * (not readable any more, the network…). Called while rendering: nothing is reported here (the
 * function reports its own failures).
 */
export function previewErrorMessage(error: unknown): string {
  if (error instanceof FunctionCallError && error.code === 'rate_limited') {
    return `${t('storage.errors.signRateLimited')} ${retryInText(error.retryAfter)}`
  }
  return t('storage.preview.unavailable')
}
