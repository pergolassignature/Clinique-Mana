/**
 * Test doubles for the Google busy-time functions (R6): the fake Google
 * (`fake-gmail.ts`: OAuth, userinfo, FreeBusy), a service-role Supabase double
 * whose calendar RPCs keep one connection in memory, and the caller's client.
 * Test-only: no `index.ts` imports this folder.
 */
import type { Deps } from '../deps.ts'
import { fakeSupabase, type RpcRoute } from './fake-supabase.ts'
import {
  FAKE_CALENDAR_CLIENT_ID,
  FAKE_CALENDAR_CLIENT_SECRET,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  fakeGmail,
} from './fake-gmail.ts'
import { accessFixture, ADMIN_ID, ORG_ID } from './email-fixtures.ts'

export { ADMIN_ID, ORG_ID }
export const SECRET = 'local-dev-internal-function-secret'
export const NOW = '2026-10-13T15:00:00.000Z'
export const CONNECTION_ID = '00000000-0000-4000-8000-00000000ca01'
export const CONNECTED_AT = '2026-10-01T15:00:00.000Z'
export const ACCOUNT = 'pro.agenda@example.test'
export const GOOGLE_ORIGIN = 'http://fake-google.test'
export const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy'

export interface CalendarConnectionState {
  state: 'connected' | 'needs_reconnect' | 'disconnected'
  access: string
  refresh: string
  expiresAt: string
  scopes: string[]
}

export interface CalendarDbState {
  connection: CalendarConnectionState | null
  secrets: Record<string, string | null>
  /** What `replace_calendar_busy_for_service` received, in order. */
  replaced: { from: string; to: string; blocks: unknown[] }[]
  /** Answer -1 (the connection changed meanwhile) on the next replace. */
  staleReplace: boolean
  reconnects: string[]
  errors: string[]
  tokenUpdates: string[]
  due: string[]
}

/** The calendars' own application's org secrets (AP-46), to add to `state.secrets`. */
export const CALENDAR_APP_SECRETS = {
  google_calendar_client_id: FAKE_CALENDAR_CLIENT_ID,
  google_calendar_client_secret: FAKE_CALENDAR_CLIENT_SECRET,
}

export function calendarHarness(opts: {
  state?: Partial<CalendarDbState>
  permissions?: string[]
  modules?: string[]
  moduleEnabled?: boolean
  rpc?: Record<string, RpcRoute>
  env?: Record<string, string | undefined>
} = {}) {
  let clock = Date.parse(NOW)
  const now = () => clock
  const google = fakeGmail({
    emailAddress: ACCOUNT,
    now,
    otherClients: [{
      id: FAKE_CALENDAR_CLIENT_ID,
      secret: FAKE_CALENDAR_CLIENT_SECRET,
    }],
  })
  const state: CalendarDbState = {
    connection: null,
    secrets: {
      google_oauth_client_id: FAKE_CLIENT_ID,
      google_oauth_client_secret: FAKE_CLIENT_SECRET,
    },
    replaced: [],
    staleReplace: false,
    reconnects: [],
    errors: [],
    tokenUpdates: [],
    due: [],
    ...opts.state,
  }
  // The connection's tokens are known to the fake Google (issued to Gmail's client).
  if (state.connection) {
    google.grants.set(state.connection.refresh, {
      scopes: state.connection.scopes,
      revoked: false,
      clientId: FAKE_CLIENT_ID,
    })
    google.tokens.set(state.connection.access, {
      expiresAt: Date.parse(state.connection.expiresAt),
      refresh: state.connection.refresh,
    })
  }
  const live = () =>
    state.connection && state.connection.state !== 'disconnected'
      ? state.connection
      : null
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      get_org_secret: (args) => ({
        data: state.secrets[args.p_key as string] ?? null,
      }),
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: { data: 'run-1' },
      finish_job_run: { data: null },
      store_calendar_connection: (args) => {
        state.connection = {
          state: 'connected',
          access: String(args.p_access_token),
          refresh: String(args.p_refresh_token),
          expiresAt: String(args.p_access_token_expires_at),
          scopes: args.p_scopes as string[],
        }
        return { data: CONNECTION_ID }
      },
      get_my_calendar_credentials_for_service: () => {
        const c = live()
        return {
          data: c
            ? [{
              connection_id: CONNECTION_ID,
              access_token: c.access,
              refresh_token: c.refresh,
            }]
            : [],
        }
      },
      disconnect_my_calendar_connection: () => {
        if (!live()) return { data: false }
        state.connection!.state = 'disconnected'
        return { data: true }
      },
      get_calendar_credentials_for_service: () => {
        const c = live()
        return {
          data: c
            ? [{
              state: c.state,
              access_token: c.access,
              refresh_token: c.refresh,
              access_token_expires_at: c.expiresAt,
              connected_at: CONNECTED_AT,
            }]
            : [],
        }
      },
      set_calendar_token_for_service: (args) => {
        if (!state.connection) return { data: false }
        state.connection.access = String(args.p_access_token)
        state.connection.expiresAt = String(args.p_access_token_expires_at)
        state.tokenUpdates.push(String(args.p_access_token_expires_at))
        return { data: true }
      },
      mark_calendar_needs_reconnect_for_service: (args) => {
        state.reconnects.push(String(args.p_reason))
        if (state.connection) state.connection.state = 'needs_reconnect'
        return { data: true }
      },
      list_calendar_connections_to_sync_for_service: () => ({
        data: state.due,
      }),
      replace_calendar_busy_for_service: (args) => {
        if (state.staleReplace) return { data: -1 }
        const blocks = args.p_blocks as unknown[]
        state.replaced.push({
          from: String(args.p_from),
          to: String(args.p_to),
          blocks,
        })
        return { data: blocks.length }
      },
      record_calendar_sync_error_for_service: (args) => {
        state.errors.push(String(args.p_error))
        return { data: null }
      },
      ...opts.rpc,
    },
  })
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(opts.permissions ?? ['appointments.self']),
          modules: opts.modules ?? ['appointments'],
        },
      },
    },
  })
  const env: Record<string, string | undefined> = {
    APP_URL: 'http://localhost:5173',
    INTERNAL_FUNCTION_SECRET: SECRET,
    GMAIL_API_BASE_URL: GOOGLE_ORIGIN,
    GOOGLE_OAUTH_BASE_URL: GOOGLE_ORIGIN,
    GOOGLE_ACCOUNTS_BASE_URL: GOOGLE_ORIGIN,
    GOOGLE_CERTS_BASE_URL: GOOGLE_ORIGIN,
    GOOGLE_ACCOUNTS_PUBLIC_URL: 'http://127.0.0.1:55392',
    GOOGLE_CALENDAR_BASE_URL: GOOGLE_ORIGIN,
    ...opts.env,
  }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: google.fetch,
    now: () => new Date(now()),
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return {
    deps,
    google,
    service,
    user,
    state,
    advance: (ms: number) => {
      clock += ms
    },
    rpcNames: () => service.calls.map((c) => c.fn),
  }
}

/** A connected state whose tokens the fake Google knows (`expiresAt` from `NOW`). */
export const connected = (
  over: Partial<CalendarConnectionState> = {},
): CalendarConnectionState => ({
  state: 'connected',
  access: 'ya29.fake-initial-access',
  refresh: '1//fake-refresh-initial',
  expiresAt: '2026-10-13T16:00:00.000Z',
  scopes: ['openid', 'email', FREEBUSY],
  ...over,
})
