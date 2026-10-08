import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from './client'

/**
 * A refusal from an edge function: its English `code` (`link_expired`, `rate_limited`…, see
 * `supabase/functions/_shared/auth.ts`; P3-28), the HTTP status, the function's message, and the
 * answer's other fields (`extra`, e.g. `staff-invite`'s `invitation_id`). `network` (status 0)
 * when the function could not be reached; `internal` when the answer is not the function's JSON.
 */
export class FunctionCallError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'FunctionCallError'
  }
}

const errorBodySchema = z.looseObject({ error: z.object({ code: z.string(), message: z.string() }) })

async function toFunctionCallError(error: unknown): Promise<FunctionCallError> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response
    const body = errorBodySchema.safeParse(await response.json().catch(() => null))
    if (!body.success) return new FunctionCallError('internal', response.status, 'Unexpected answer')
    const { error: refusal, ...extra } = body.data
    return new FunctionCallError(refusal.code, response.status, refusal.message, extra)
  }
  if (error instanceof FunctionsFetchError) return new FunctionCallError('network', 0, 'Function unreachable')
  return new FunctionCallError('internal', 0, error instanceof Error ? error.message : 'Unexpected error')
}

/**
 * POSTs `body` to the edge function `name` (supabase-js sends the session's token, else the anon
 * key) and returns its JSON; throws a FunctionCallError.
 */
export async function invokeFunction(name: string, body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw await toFunctionCallError(error)
  return data
}
