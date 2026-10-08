/**
 * Typed failures for edge functions: the `ErrorCode` union (defined in
 * `auth.ts`, which answers with it), `FunctionError`, thrown by shared
 * wrappers (e.g. an RPC error in `webhooks.ts`), and `rpcErrorResponse`, the
 * answer for a user-facing RPC's error.
 */
import { type ErrorCode, errorResponse } from './auth.ts'

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

/**
 * The answer for an RPC error, by SQLSTATE (plan « Error codes in SQL »):
 * P0001 → 400 `invalid_request` with the RPC's French message, for the UI to
 * show; 42501 → 403 `forbidden`; 22023 → 400 `invalid_request` (its message
 * may hold an argument: not passed through); anything else → 500 `internal`,
 * which the caller reports.
 */
export function rpcErrorResponse(
  error: { code?: string; message?: string },
  req?: Request,
): Response {
  switch (error.code) {
    case 'P0001':
      return errorResponse(
        'invalid_request',
        error.message ?? 'Invalid request',
        400,
        req,
      )
    case '42501':
      return errorResponse('forbidden', 'Not allowed', 403, req)
    case '22023':
      return errorResponse('invalid_request', 'Invalid request', 400, req)
    default:
      return errorResponse('internal', 'Request failed', 500, req)
  }
}
