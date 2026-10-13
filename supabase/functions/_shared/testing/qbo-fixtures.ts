/**
 * The QuickBooks functions' test harness (plan §8, FQ): the fake Intuit
 * (`fake-qbo.ts`), a service client whose RPCs keep the connection, the
 * accounts and the customers in memory as the migration's RPCs do, and a
 * user client for `verifyAuth`. Test-only: no `index.ts` imports it.
 */
import { accessFixture, ADMIN_ID, ORG_ID } from './email-fixtures.ts'
import { fakeQbo, type FakeQboOptions, seedCompany } from './fake-qbo.ts'
import { fakeSupabase, type RpcRoute } from './fake-supabase.ts'

export const FAKE_ORIGIN = 'http://fake-intuit.test'
export const NOW = '2026-10-13T12:00:00.000Z'
export const CONNECTION_ID = '00000000-0000-4000-8000-0000000000c1'
export const REDIRECT = 'http://localhost:5173/facturation/retour-quickbooks'

export interface QboState {
  connection: {
    id: string
    realm: string
    environment: 'production' | 'sandbox'
    status: string
    access: string
    refresh: string
    expiresAt: string
  } | null
  secrets: Record<string, string | null>
  accounts: unknown[]
  customers: Map<string, Record<string, unknown>>
  /** How many customers `match_qbo_customers` still has to match. */
  toMatch: number
  finished: Record<string, unknown>[]
}

export function initialState(): QboState {
  return {
    connection: null,
    secrets: {
      qbo_client_id: 'local-dev-qbo-client-id',
      qbo_client_secret: 'local-dev-qbo-client-secret',
    },
    accounts: [],
    customers: new Map(),
    toMatch: 0,
    finished: [],
  }
}

const ok = (data: unknown) => ({ data, error: null })

function qboRoutes(state: QboState): Record<string, RpcRoute> {
  return {
    consume_rate_limit: ok([{
      allowed: true,
      hits: 1,
      retry_after_seconds: 0,
    }]),
    module_enabled_for_org: ok(true),
    get_org_secret: (args) => ok(state.secrets[args.p_key as string] ?? null),
    get_qbo_credentials: () =>
      ok(
        state.connection && state.connection.status !== 'disconnected'
          ? [{
            connection_id: state.connection.id,
            realm_id: state.connection.realm,
            environment: state.connection.environment,
            status: state.connection.status,
            access_token: state.connection.access,
            refresh_token: state.connection.refresh,
            access_token_expires_at: state.connection.expiresAt,
          }]
          : [],
      ),
    store_qbo_connection: (args) => {
      if (
        state.connection && state.connection.status !== 'disconnected' &&
        state.connection.realm !== args.p_realm_id
      ) {
        return {
          data: null,
          error: {
            code: 'P0001',
            message:
              'La clinique est déjà reliée à une autre entreprise QuickBooks. Déconnectez-la d’abord.',
          },
        }
      }
      state.connection = {
        id: CONNECTION_ID,
        realm: args.p_realm_id as string,
        environment: args.p_environment as 'production' | 'sandbox',
        status: 'connected',
        access: args.p_access_token as string,
        refresh: args.p_refresh_token as string,
        expiresAt: args.p_access_token_expires_at as string,
      }
      return ok(CONNECTION_ID)
    },
    disconnect_qbo_connection: () => {
      if (!state.connection || state.connection.status === 'disconnected') {
        return ok(false)
      }
      state.connection.status = 'disconnected'
      return ok(true)
    },
    set_qbo_tokens: (args) => {
      if (
        !state.connection ||
        state.connection.refresh !== args.p_previous_refresh
      ) return ok(false)
      state.connection.access = args.p_access_token as string
      state.connection.refresh = args.p_refresh_token as string
      state.connection.expiresAt = args.p_access_token_expires_at as string
      if (state.connection.status === 'needs_reconnect') {
        state.connection.status = 'connected'
      }
      return ok(true)
    },
    set_qbo_connection_status: (args) => {
      if (state.connection) state.connection.status = args.p_status as string
      return ok(null)
    },
    replace_qbo_accounts: (args) => {
      state.accounts = args.p_accounts as unknown[]
      return ok(0)
    },
    upsert_qbo_customers: (args) => {
      let changed = 0
      for (const c of args.p_customers as Record<string, unknown>[]) {
        if (state.customers.get(c.id as string)?.hash !== c.hash) changed++
        state.customers.set(c.id as string, c)
      }
      state.toMatch += changed
      return ok(changed)
    },
    prune_qbo_customers: ok(0),
    match_qbo_customers: (args) => {
      const n = Math.min(state.toMatch, args.p_limit as number)
      state.toMatch -= n
      return ok(n)
    },
    finish_qbo_sync: (args) => {
      state.finished.push(args)
      return ok(null)
    },
  }
}

export interface QboHarnessOptions {
  state?: QboState
  permissions?: string[]
  modules?: string[]
  rpc?: Record<string, RpcRoute>
  qbo?: FakeQboOptions
  /** Connect the state to a grant of the fake company first. */
  connected?: boolean
  seed?: boolean
}

export function qboHarness(opts: QboHarnessOptions = {}) {
  const state = opts.state ?? initialState()
  let clock = Date.parse(NOW)
  const intuit = fakeQbo({ now: () => clock, ...opts.qbo })
  if (opts.seed !== false) seedCompany(intuit)
  if (opts.connected) {
    const grant = intuit.grant()
    state.connection = {
      id: CONNECTION_ID,
      realm: intuit.realmId,
      environment: 'sandbox',
      status: 'connected',
      access: grant.access_token,
      refresh: grant.refresh_token,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
    }
  }
  const service = fakeSupabase({ rpc: { ...qboRoutes(state), ...opts.rpc } })
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(opts.permissions ?? ['billing.settings']),
          modules: opts.modules ?? ['billing'],
        },
      },
    },
  })
  const env: Record<string, string | undefined> = {
    APP_URL: 'http://localhost:5173',
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    QBO_APPCENTER_BASE_URL: FAKE_ORIGIN,
    QBO_APPCENTER_PUBLIC_URL: 'http://127.0.0.1:55394',
    QBO_OAUTH_BASE_URL: FAKE_ORIGIN,
    QBO_REVOKE_BASE_URL: FAKE_ORIGIN,
    QBO_API_BASE_URL: FAKE_ORIGIN,
  }
  return {
    state,
    intuit,
    service,
    user,
    env,
    deps: {
      env: (key: string) => env[key],
      fetch: intuit.fetch as typeof fetch,
      now: () => new Date(clock),
      serviceClient: () => service.client,
      userClient: () => user.client,
    },
    advance(ms: number) {
      clock += ms
    },
    rpcNames: () => service.calls.map((c) => c.fn),
  }
}

export { ADMIN_ID, ORG_ID }
