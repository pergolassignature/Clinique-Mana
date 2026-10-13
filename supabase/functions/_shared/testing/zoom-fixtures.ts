/**
 * Test doubles for the Zoom functions (RZ): the fake Zoom, a service-role
 * Supabase double whose video RPCs keep a small in-memory state (the
 * connection, its tokens, the tasks, the meetings), a caller's client, and a
 * signed job request. Test-only: no `index.ts` imports this folder.
 */
import type { Deps } from '../deps.ts'
import { fakeSupabase, type RpcRoute } from './fake-supabase.ts'
import { fakeFetch } from './fake-fetch.ts'
import {
  FAKE_ZOOM_CLIENT_ID,
  FAKE_ZOOM_CLIENT_SECRET,
  fakeZoom,
} from './fake-zoom.ts'
import {
  accessFixture,
  ADMIN_ID,
  emailContextFixture,
  ORG_ID,
} from './email-fixtures.ts'

export { ADMIN_ID, ORG_ID }
export const SECRET = 'local-dev-internal-function-secret'
export const NOW = '2026-10-13T15:00:00.000Z'
export const CONNECTION_ID = '00000000-0000-4000-8000-00000000d001'
export const APPOINTMENT_ID = '00000000-0000-4000-8000-00000000e001'
export const ZOOM_ORIGIN = 'http://fake-zoom.test'
export const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'

export interface ConnectionState {
  state: 'connected' | 'needs_reconnect' | 'disconnected'
  access: string
  refresh: string
  expiresAt: string
}

export interface ZoomTask {
  appointment_id: string
  generation: number
  attempts: number
  wants_video: boolean
  target_connection_id: string | null
  starts_at: string
  ends_at: string
  timezone: string
  meeting_connection_id: string | null
  meeting_connection_state: string | null
  meeting_external_id: string | null
  meeting_join_url: string | null
}

export interface ZoomDbState {
  connection: ConnectionState | null
  secrets: Record<string, string | null>
  tasks: ZoomTask[]
  completions: Record<string, unknown>[]
  /** What `complete_video_task_for_service` answers (email the link?). */
  emailOnCreate: boolean
  recipients: Record<string, unknown>[]
  emailed: string[]
  refreshDue: string[]
  reconnects: string[]
}

export const task = (over: Partial<ZoomTask> = {}): ZoomTask => ({
  appointment_id: APPOINTMENT_ID,
  generation: 1,
  attempts: 0,
  wants_video: true,
  target_connection_id: CONNECTION_ID,
  starts_at: '2026-10-15T18:30:00+00:00',
  ends_at: '2026-10-15T19:20:00+00:00',
  timezone: 'America/Toronto',
  meeting_connection_id: null,
  meeting_connection_state: null,
  meeting_external_id: null,
  meeting_join_url: null,
  ...over,
})

export function zoomHarness(opts: {
  state?: Partial<ZoomDbState>
  permissions?: string[]
  modules?: string[]
  moduleEnabled?: boolean
  rpc?: Record<string, RpcRoute>
  env?: Record<string, string | undefined>
} = {}) {
  let clock = Date.parse(NOW)
  const now = () => clock
  const zoom = fakeZoom({ now })
  const state: ZoomDbState = {
    connection: null,
    secrets: {
      zoom_client_id: FAKE_ZOOM_CLIENT_ID,
      zoom_client_secret: FAKE_ZOOM_CLIENT_SECRET,
      zoom_webhook_secret: 'zoom-webhook-secret',
    },
    tasks: [],
    completions: [],
    emailOnCreate: false,
    recipients: [],
    emailed: [],
    refreshDue: [],
    reconnects: [],
    ...opts.state,
  }
  // The connection's tokens are known to the fake Zoom.
  if (state.connection) {
    zoom.grants.set(state.connection.refresh, {
      user: 'fakeZoomUser01',
      revoked: false,
    })
    zoom.tokens.set(state.connection.access, {
      expiresAt: Date.parse(state.connection.expiresAt),
      user: 'fakeZoomUser01',
      revoked: false,
    })
  }
  const credentials = () =>
    state.connection && state.connection.state !== 'disconnected'
      ? [{
        state: state.connection.state,
        access_token: state.connection.access,
        refresh_token: state.connection.refresh,
        access_token_expires_at: state.connection.expiresAt,
      }]
      : []
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
      get_my_zoom_credentials_for_service: () => ({
        data: credentials().map((c) => ({
          connection_id: CONNECTION_ID,
          access_token: c.access_token,
          refresh_token: c.refresh_token,
        })),
      }),
      disconnect_my_zoom_connection: () => {
        if (!state.connection || state.connection.state === 'disconnected') {
          return { data: false }
        }
        state.connection.state = 'disconnected'
        return { data: true }
      },
      store_zoom_connection: (args) => {
        state.connection = {
          state: 'connected',
          access: String(args.p_access_token),
          refresh: String(args.p_refresh_token),
          expiresAt: String(args.p_access_token_expires_at),
        }
        return { data: CONNECTION_ID }
      },
      get_zoom_credentials_for_service: () => ({ data: credentials() }),
      set_zoom_tokens_for_service: (args) => {
        if (!state.connection) return { data: false }
        state.connection.access = String(args.p_access_token)
        state.connection.refresh = String(args.p_refresh_token)
        state.connection.expiresAt = String(args.p_access_token_expires_at)
        return { data: true }
      },
      mark_zoom_needs_reconnect_for_service: (args) => {
        state.reconnects.push(String(args.p_reason))
        if (state.connection) state.connection.state = 'needs_reconnect'
        return { data: true }
      },
      list_zoom_connections_to_refresh_for_service: () => ({
        data: state.refreshDue,
      }),
      claim_video_tasks_for_service: () => {
        const claimed = state.tasks
        state.tasks = []
        return { data: claimed }
      },
      complete_video_task_for_service: (args) => {
        state.completions.push(args)
        return {
          data: state.emailOnCreate && args.p_join_url !== null &&
            args.p_error_code === null,
        }
      },
      video_link_email_for_service: () => ({ data: state.recipients }),
      mark_video_link_emailed_for_service: (args) => {
        state.emailed.push(String(args.p_join_url))
        return { data: null }
      },
      zoom_deauthorized_for_service: () => ({ data: 1 }),
      get_email_context: {
        data: emailContextFixture({
          module_key: 'appointments',
          template: {
            key: 'appointments.video_link',
            subject: 'Votre lien de rencontre',
            body: 'Bonjour {{client.first_name}}',
            button_label: 'Rejoindre la rencontre',
            view_permission: 'appointments.view',
            variables: [{
              path: 'client.first_name',
              label: 'Prénom',
              sample: 'x',
              required: true,
              kind: 'text',
            }],
          },
        }),
      },
      queue_email: { data: '00000000-0000-4000-8000-00000000f001' },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
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
  const mail = fakeFetch({
    [MAILPIT]: () => new Response(JSON.stringify({ ID: 'm' }), { status: 200 }),
  })
  const env: Record<string, string | undefined> = {
    APP_URL: 'http://localhost:5173',
    INTERNAL_FUNCTION_SECRET: SECRET,
    ZOOM_OAUTH_BASE_URL: ZOOM_ORIGIN,
    ZOOM_API_BASE_URL: ZOOM_ORIGIN,
    ZOOM_OAUTH_PUBLIC_URL: 'http://127.0.0.1:55394',
    EMAIL_TRANSPORT: 'mailpit',
    MAILPIT_URL: 'http://mailpit.test:8025',
    ...opts.env,
  }
  const fetchFn: typeof fetch = (input, init) => {
    const url = new Request(input, init).url
    return url.startsWith(ZOOM_ORIGIN)
      ? zoom.fetch(input, init)
      : mail.fetch(input, init)
  }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: fetchFn,
    now: () => new Date(now()),
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return {
    deps,
    zoom,
    service,
    mail,
    state,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

/** A user request with a bearer token and the dev origin. */
export const post = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      Authorization: 'Bearer tok',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')

/** A signed job request for `jobKey` at `NOW`. */
export async function jobRequest(
  jobKey: string,
  url: string,
): Promise<Request> {
  const t = Math.floor(Date.parse(NOW) / 1000)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${t}.${jobKey}..cron`),
    ),
  )
  return new Request(url, {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${t},v1=${mac}` },
    body: JSON.stringify({ job_key: jobKey, org_id: null, trigger: 'cron' }),
  })
}
