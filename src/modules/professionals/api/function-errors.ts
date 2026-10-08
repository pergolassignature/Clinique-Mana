import { FunctionCallError, refusalMessage } from '@/core/supabase/functions'

/**
 * A module function's error as the RPC error it passes on, so `moduleErrorMessage`,
 * `rpcErrorCode` and `rpcErrorHint` read it as for an RPC called directly (P4-262): a refusal
 * (400 `invalid_request` with `refusal`: a P0001's French message, its HINT as `field`) →
 * `{ code: 'P0001', message, hint }`; 403 `forbidden` (42501) → `{ code: '42501' }`; 409
 * `conflict` (40001, « Le dossier vient de changer », `professionals-set-status`) →
 * `{ code: '40001' }`. Anything else stays the `FunctionCallError`.
 */
export function asRpcRefusal(error: unknown): unknown {
  if (!(error instanceof FunctionCallError)) return error
  const refusal = refusalMessage(error)
  if (refusal !== null) return { code: 'P0001', message: refusal, ...(error.field && { hint: error.field }) }
  if (error.status === 403 && error.code === 'forbidden') return { code: '42501', message: error.message }
  if (error.status === 409 && error.code === 'conflict') return { code: '40001', message: error.message }
  return error
}
