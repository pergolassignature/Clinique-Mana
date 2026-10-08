import * as Sentry from '@sentry/react'
import { t } from '@/i18n'

/**
 * The message to show for a failed module RPC, from an allow-list of SQLSTATE codes.
 *
 * Convention (docs/standards/database-conventions.md §6): a message written for users is raised
 * with `raise exception '…' using errcode = 'P0001'` and is in French. Every other code (invalid
 * argument, timeout, deadlock, PostgREST/JWT errors, network failures) carries a technical message,
 * so the user gets the fallback and the error goes to Sentry. Two expected codes get a generic text:
 * - `42501` (permission refused): the UI hides what the user cannot do, so it only follows a
 *   permission change or a bypass. Not reported;
 * - `23514` (check violation): the Zod schemas mirror the SQL checks, so it only follows a bypassed
 *   form or a Zod/SQL parity bug. Reported, since we want to hear about either.
 *
 * `area` tags the Sentry report (e.g. `'settings'`), with the code. The report carries the message
 * only, never the error object (see `rpcErrorReport`).
 */
export function moduleErrorMessage(error: unknown, fallback: string, area = 'modules'): string {
  const code = rpcErrorCode(error)
  const message = stringField(error, 'message')

  if (code === 'P0001' && typeof message === 'string' && message !== '') return message
  if (code === '42501') return t('common.errors.forbidden')

  const reportedCode = code !== undefined && code !== '' ? code : 'unknown'
  Sentry.captureException(rpcErrorReport(reportedCode, error instanceof Error ? error : (message ?? error)), { tags: { area, code: reportedCode } })
  return code === '23514' ? t('common.errors.invalidValue') : fallback
}

/** A string field of a failed RPC's error (a PostgREST error is a plain object or an Error with these fields). */
function stringField(error: unknown, field: 'code' | 'message' | 'hint' | 'details'): string | undefined {
  if (typeof error !== 'object' || error === null || !(field in error)) return undefined
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

/** The SQLSTATE of a failed RPC (`P0001`, `42501`…), or undefined for an error without one. */
export function rpcErrorCode(error: unknown): string | undefined {
  return stringField(error, 'code')
}

/**
 * The HINT of a failed RPC, for the caller to route a refusal without matching its French text
 * (e.g. `role_missing`, `copy_from`); undefined when there is none. Only read here: Sentry never
 * gets it (see `rpcErrorReport`).
 */
export function rpcErrorHint(error: unknown): string | undefined {
  const hint = stringField(error, 'hint')
  return hint === '' ? undefined : hint
}

/**
 * The DETAIL of a failed RPC (PostgREST `details`), where a refusal about one item of a list names
 * it (e.g. the title id of a licence refusal, so the form marks that row); undefined when empty.
 * Like the hint, only read here: Sentry never gets it.
 */
export function rpcErrorDetail(error: unknown): string | undefined {
  const details = stringField(error, 'details')
  return details === '' ? undefined : details
}

/**
 * What goes to Sentry: a fresh Error from the message only, named `RpcError <code>`. Never the raw
 * error object: PostgreSQL's `details` and `hint` can hold row values (« Failing row contains (…) »).
 * A real JS `Error` (a network TypeError…) keeps its stack and its name (`RpcError unknown (TypeError)`):
 * a JS stack never holds `details`. `main.tsx` scrubs events again before sending (`scrubSentryEvent`).
 */
function rpcErrorReport(code: string, source: unknown): Error {
  if (source instanceof Error) {
    const report = new Error(source.message)
    report.name = `RpcError ${code} (${source.name})`
    report.stack = source.stack
    return report
  }
  const report = new Error(typeof source === 'string' ? source : String(source))
  report.name = `RpcError ${code}`
  return report
}
