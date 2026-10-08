/**
 * A Supabase client double for function tests. Functions reach the database
 * only through `rpc` and `storage` (plan « Conventions »), so the fake is a
 * router over those two, with a call log. Test-only: never deployed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** What a routed call resolves to; omitted fields default to null. */
export interface FakeResult {
  data?: unknown
  error?: { code?: string; message?: string } | null
}

/** A fixed result, or a function of the RPC arguments. */
export type RpcRoute =
  | FakeResult
  | ((args: Record<string, unknown>) => FakeResult | Promise<FakeResult>)

/** Handles `storage.from(bucket).<method>(...args)`. */
export type StorageRoute = (
  bucket: string,
  ...args: unknown[]
) => FakeResult | Promise<FakeResult>

export interface FakeSupabase {
  client: SupabaseClient
  calls: Array<{ fn: string; args: Record<string, unknown> }>
  storageCalls: Array<{ bucket: string; method: string; args: unknown[] }>
}

const normalise = (r: FakeResult) => ({
  data: r.data ?? null,
  error: r.error ?? null,
})

/** Builds a fake client from RPC routes (by name) and storage routes (by method). */
export function fakeSupabase(
  routes: {
    rpc?: Record<string, RpcRoute>
    storage?: Record<string, StorageRoute>
  },
): FakeSupabase {
  const calls: FakeSupabase['calls'] = []
  const storageCalls: FakeSupabase['storageCalls'] = []
  const client = {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args })
      const route = routes.rpc?.[fn]
      if (route === undefined) {
        return {
          data: null,
          error: { code: 'PGRST202', message: `fake: no rpc ${fn}` },
        }
      }
      return normalise(typeof route === 'function' ? await route(args) : route)
    },
    storage: {
      from: (bucket: string) =>
        Object.fromEntries(
          Object.entries(routes.storage ?? {}).map(([method, route]) => [
            method,
            async (...args: unknown[]) => {
              storageCalls.push({ bucket, method, args })
              return normalise(await route(bucket, ...args))
            },
          ]),
        ),
    },
  }
  return { client: client as unknown as SupabaseClient, calls, storageCalls }
}
