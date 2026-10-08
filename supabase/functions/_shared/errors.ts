/**
 * Typed failures for edge functions: the `ErrorCode` union (defined in
 * `auth.ts`, which answers with it) and `FunctionError`, thrown by shared
 * wrappers (e.g. an RPC error in `webhooks.ts`).
 */
import type { ErrorCode } from './auth.ts'

export type { ErrorCode }

/**
 * A failure with an `ErrorCode`, thrown by shared wrappers (e.g. an RPC error).
 * The message names the operation and a SQLSTATE at most, never a value.
 */
export class FunctionError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'FunctionError'
  }
}
