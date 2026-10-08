import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from './client'

/**
 * A refusal from an edge function: its English `code` (`link_expired`, `rate_limited`…, see
 * `supabase/functions/_shared/auth.ts`; P3-28), the HTTP status, the function's message, and the
 * answer's other fields (`extra`): those next to `error` (`staff-invite`'s `invitation_id`) and
 * those inside it (`email-preview`'s `variable`, `staff-invite`'s `field`). `retryAfter` is a 429's
 * `Retry-After`, in seconds. `network` (status 0) when the function could not be reached;
 * `internal` when the answer is not the function's JSON.
 */
export class FunctionCallError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'FunctionCallError'
  }

  /** The field a 400 names (`staff-invite`: `email`, `display_name`, `role`), if any. */
  get field(): string | undefined {
    return typeof this.extra.field === 'string' ? this.extra.field : undefined
  }
}

/**
 * The French text of a refusal the user can act on, or null: a 400 `invalid_request` that the
 * function flagged `refusal: true` (`refusalResponse` in `supabase/functions/_shared/auth.ts`): an
 * RPC's P0001 passed on, or a function's own French sentence (« Ce fichier n'est pas du type
 * annoncé. »). Any other 400 carries an English message, which the caller replaces with its
 * generic text.
 */
export function refusalMessage(error: FunctionCallError): string | null {
  return error.status === 400 && error.code === 'invalid_request' && error.extra.refusal === true && error.message !== ''
    ? error.message
    : null
}

const errorBodySchema = z.looseObject({ error: z.looseObject({ code: z.string(), message: z.string() }) })

/** `Retry-After` in seconds (the functions send a number), or null. */
function retryAfterOf(response: Response): number | null {
  const value = Number(response.headers.get('Retry-After') ?? '')
  return Number.isFinite(value) && value > 0 ? value : null
}

async function toFunctionCallError(error: unknown): Promise<FunctionCallError> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response
    const body = errorBodySchema.safeParse(await response.json().catch(() => null))
    if (!body.success) return new FunctionCallError('internal', response.status, 'Unexpected answer', {}, retryAfterOf(response))
    const {
      error: { code, message, ...inner },
      ...outer
    } = body.data
    return new FunctionCallError(code, response.status, message, { ...outer, ...inner }, retryAfterOf(response))
  }
  if (error instanceof FunctionsFetchError) return new FunctionCallError('network', 0, 'Function unreachable')
  return new FunctionCallError('internal', 0, error instanceof Error ? error.message : 'Unexpected error')
}

export interface InvokeOptions {
  /** Cancels the call (a query's signal). */
  signal?: AbortSignal
}

/**
 * POSTs `body` to the edge function `name` (supabase-js sends the session's token, else the anon
 * key) and returns its JSON; throws a FunctionCallError.
 */
export async function invokeFunction(name: string, body: Record<string, unknown>, { signal }: InvokeOptions = {}): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, { body, ...(signal && { signal }) })
  if (error) throw await toFunctionCallError(error)
  return data
}
