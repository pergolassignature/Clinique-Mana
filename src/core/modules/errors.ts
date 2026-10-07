import * as Sentry from '@sentry/react'
import { t } from '@/i18n'

/**
 * The message to show for a failed module RPC, from an allow-list of SQLSTATE codes.
 *
 * Convention (docs/standards/database-conventions.md §6): a message written for users is raised
 * with `raise exception '…' using errcode = 'P0001'` and is in French. Every other code (invalid
 * argument, timeout, deadlock, PostgREST/JWT errors, network failures) carries a technical message,
 * so the user gets the fallback and the error goes to Sentry. Two expected codes get a generic text
 * and are not reported:
 * - `42501` (permission refused): the UI hides what the user cannot do, so it only follows a
 *   permission change or a bypass;
 * - `23514` (check violation): the client validates first, so it only follows a bypassed form.
 */
export function moduleErrorMessage(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined

  if (code === 'P0001' && typeof message === 'string' && message !== '') return message
  if (code === '42501') return t('common.errors.forbidden')
  if (code === '23514') return t('common.errors.invalidValue')

  Sentry.captureException(error, { tags: { area: 'modules' } })
  return fallback
}
