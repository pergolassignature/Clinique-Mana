/**
 * A Supabase client double for function tests. Functions reach the database
 * through `rpc` and `storage` (plan « Conventions »), so the fake is a
 * router over those two, with a call log (a storage call also answers
 * `.asStream()`, for `download`), plus `auth.getUser` for a caller's
 * client (`verifyAuth`) and the `auth.admin` methods a service client uses
 * (`createUser`, `deleteUser`, `updateUserById`). The few table reads a
 * function makes (`from(t).select(…).eq(…).maybeSingle()`, see CLAUDE.md §7)
 * are routed by table, with their filters logged. Test-only: never deployed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** What a routed call resolves to; omitted fields default to null. */
export interface FakeResult {
  data?: unknown
  error?:
    | { code?: string; message?: string; hint?: string; details?: string }
    | null
}

/** A fixed result, or a function of the RPC arguments. */
export type RpcRoute =
  | FakeResult
  | ((args: Record<string, unknown>) => FakeResult | Promise<FakeResult>)

/** Handles `storage.from(bucket).<method>(...args)`; an unrouted method throws. */
export type StorageRoute = (
  bucket: string,
  ...args: unknown[]
) => FakeResult | Promise<FakeResult>

/** A `from(table)` read: its select list, its `eq` filters, `maybeSingle`. */
export interface TableQuery {
  table: string
  columns: string
  eq: Record<string, unknown>
  single: boolean
}

/** Handles a `from(table)` read; an unrouted table throws. */
export type TableRoute = (
  query: TableQuery,
) => FakeResult | Promise<FakeResult>

/** Handles `auth.admin.<method>(...args)`; an unrouted method throws. */
export type AdminRoute = (
  ...args: unknown[]
) => FakeResult | Promise<FakeResult>

export interface FakeSupabase {
  client: SupabaseClient
  calls: Array<{ fn: string; args: Record<string, unknown> }>
  storageCalls: Array<{ bucket: string; method: string; args: unknown[] }>
  /** The tokens passed to `auth.getUser`. */
  authCalls: string[]
  /** The `auth.admin` calls, in order. */
  adminCalls: Array<{ method: string; args: unknown[] }>
  /** The `from(table)` reads, in order (logged when awaited). */
  tableCalls: TableQuery[]
}

const normalise = (r: FakeResult) => ({
  data: r.data ?? null,
  error: r.error ?? null,
})

/** A Proxy whose string keys are routed methods; an unrouted one throws when called. */
function routedMethods<R>(
  label: string,
  routes: Record<string, R> | undefined,
  call: (method: string, route: R) => unknown,
): object {
  return new Proxy({}, {
    get: (_target, method) => {
      // Not a thenable, and no symbol keys (inspection, iteration).
      if (typeof method !== 'string' || method === 'then') return undefined
      const route = routes?.[method]
      if (route === undefined) {
        return () => {
          throw new Error(`fake: no ${label}.${method}`)
        }
      }
      return call(method, route)
    },
  })
}

/**
 * Builds a fake client from RPC routes (by name), storage routes (by method)
 * and `auth.admin` routes (by method). `user` is what `auth.getUser` answers;
 * without one it answers a 401 error (an invalid token).
 */
export function fakeSupabase(
  routes: {
    rpc?: Record<string, RpcRoute>
    storage?: Record<string, StorageRoute>
    admin?: Record<string, AdminRoute>
    tables?: Record<string, TableRoute>
    user?: { id: string }
  },
): FakeSupabase {
  const calls: FakeSupabase['calls'] = []
  const storageCalls: FakeSupabase['storageCalls'] = []
  const authCalls: string[] = []
  const adminCalls: FakeSupabase['adminCalls'] = []
  const tableCalls: TableQuery[] = []
  const client = {
    from: (table: string) => {
      const route = routes.tables?.[table]
      if (route === undefined) throw new Error(`fake: no table ${table}`)
      const query: TableQuery = { table, columns: '*', eq: {}, single: false }
      const run = async () => {
        tableCalls.push(query)
        return normalise(await route(query))
      }
      const builder = {
        select: (columns = '*') => {
          query.columns = columns
          return builder
        },
        eq: (column: string, value: unknown) => {
          query.eq[column] = value
          return builder
        },
        maybeSingle: () => {
          query.single = true
          return run()
        },
        then: <T>(
          resolve: (r: Awaited<ReturnType<typeof run>>) => T,
          reject?: (e: unknown) => T,
        ) => run().then(resolve, reject),
      }
      return builder
    },
    auth: {
      admin: routedMethods(
        'auth.admin',
        routes.admin,
        (method, route: AdminRoute) => async (...args: unknown[]) => {
          adminCalls.push({ method, args })
          return normalise(await route(...args))
        },
      ),
      getUser: (token: string) => {
        authCalls.push(token)
        return Promise.resolve(
          routes.user ? { data: { user: routes.user }, error: null } : {
            data: { user: null },
            error: Object.assign(new Error('fake: invalid token'), {
              status: 401,
            }),
          },
        )
      },
    },
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
      // A Proxy, so an unrouted method fails loudly instead of being undefined.
      from: (bucket: string) =>
        routedMethods(
          'storage',
          routes.storage,
          (method, route: StorageRoute) => (...args: unknown[]) => {
            storageCalls.push({ bucket, method, args })
            const result =
              (async () => normalise(await route(bucket, ...args)))()
            // `download(path).asStream()`: the route returns the stream as data.
            return Object.assign(result, { asStream: () => result })
          },
        ),
    },
  }
  return {
    client: client as unknown as SupabaseClient,
    calls,
    storageCalls,
    authCalls,
    adminCalls,
    tableCalls,
  }
}
