/**
 * Typed failures for edge functions: the `ErrorCode` union (defined in
 * `auth.ts`, which answers with it), `FunctionError`, thrown by shared
 * wrappers (e.g. an RPC error in `webhooks.ts`), and `rpcErrorResponse`, the
 * answer for a user-facing RPC's error.
 */
import { type ErrorCode, errorResponse, refusalResponse } from './auth.ts'

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
 * P0001 → 400 `invalid_request` with the RPC's French message, flagged
 * `refusal: true` for the UI to show (`refusalResponse`); 42501 → 403 `forbidden`; 22023 → 400 `invalid_request` (its message
 * may hold an argument: not passed through); anything else → 500 `internal`,
 * which the caller reports.
 */
export function rpcErrorResponse(
  error: { code?: string; message?: string },
  req?: Request,
): Response {
  switch (error.code) {
    case 'P0001':
      return error.message
        ? refusalResponse(error.message, req)
        : errorResponse('invalid_request', 'Invalid request', 400, req)
    case '42501':
      return errorResponse('forbidden', 'Not allowed', 403, req)
    case '22023':
      return errorResponse('invalid_request', 'Invalid request', 400, req)
    default:
      return errorResponse('internal', 'Request failed', 500, req)
  }
}

/** The HTTP status each `ErrorCode` answers with (CLAUDE.md §7). */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  missing_variable: 400,
  weak_password: 400,
  unauthenticated: 401,
  forbidden: 403,
  module_disabled: 403,
  not_found: 404,
  conflict: 409,
  link_invalid: 410,
  link_expired: 410,
  link_used: 410,
  rate_limited: 429,
  server_misconfigured: 500,
  internal: 500,
  provider_error: 502,
  auth_unavailable: 503,
  not_configured: 503,
}

/**
 * The answer for a thrown `FunctionError` (already reported where it was
 * thrown): its own code with that code's status (e.g. `not_found` → 404),
 * and the caller's generic message, never the error's.
 */
export function functionErrorResponse(
  error: FunctionError,
  message: string,
  req?: Request,
): Response {
  return errorResponse(error.code, message, STATUS_BY_CODE[error.code], req)
}
