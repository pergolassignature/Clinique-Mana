/**
 * What a function's `handler.ts` needs from the outside world, injected so the
 * handler is testable without a server (plan « Conventions »):
 *
 *   // index.ts — wiring only
 *   Deno.serve(createHandler(defaultDeps()))
 *
 * Tests pass fakes instead (`testing/fake-supabase.ts`, `fake-fetch.ts`,
 * `fixed-clock.ts`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceRoleClient, getUserClient } from './auth.ts'

/** The injected dependencies of a handler. */
export interface Deps {
  env: (key: string) => string | undefined
  /** Every outbound HTTP call (Resend, Documenso, Gotenberg) goes through this. */
  fetch: typeof fetch
  now: () => Date
  /** Bypasses RLS: only after `verifyServiceRoleAuth` or a verified signature. */
  serviceClient: () => SupabaseClient | Response
  /** Acts as the caller (RLS applies). */
  userClient: (token: string) => SupabaseClient | Response
}

/** The production dependencies: `Deno.env`, global `fetch`, the system clock, the auth client factories. */
export function defaultDeps(): Deps {
  return {
    env: (key) => Deno.env.get(key),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    serviceClient: () => getServiceRoleClient(),
    userClient: (token) => getUserClient(token),
  }
}
