/**
 * Test doubles for the Gmail functions: a fake Google (`fakeGmail`), a
 * service-role Supabase double whose mail RPCs keep an in-memory state (the
 * connection, its tokens, the sync state, the rows the sync writes), and a
 * caller's client with the access the function needs. Test-only: no
 * `index.ts` imports this folder.
 */
import {
  type FakeResult,
  fakeSupabase,
  type RpcRoute,
} from './fake-supabase.ts'
import {
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  fakeGmail,
  type FakeGmailOptions,
} from './fake-gmail.ts'
import { accessFixture, ADMIN_ID, ORG_ID } from './email-fixtures.ts'

export const CONNECTION_ID = '00000000-0000-4000-8000-00000000c001'
export const MAILBOX = 'info@clinique.test'
export const PUBSUB_TOKEN = 'local-dev-gmail-pubsub-token'
export const TOPIC = 'projects/mana-local/topics/gmail-push'
export const FAKE_ORIGIN = 'http://fake-google.test'
export const NOW = '2026-10-12T15:00:00.000Z'

/** The in-memory state the service double keeps. */
export interface MailState {
  connection: {
    status: string
    reason: string | null
    email: string
    scopes: string[]
    access: string
    refresh: string
    expiresAt: string
  } | null
  sync: {
    history_id: string | null
    lease_token: string | null
    lease_until: number | null
    initial_sync_done: boolean
    initial_sync_page_token: string | null
    watch_expires_at: string | null
    sync_requested_at: string | null
    last_sync_at: string | null
    last_status: string | null
    last_error: string | null
    messages: number
  }
  /** Every element passed to upsert_mail_messages, in order. */
  upserted: Record<string, unknown>[]
  deleted: string[]
  labelChanges: Record<string, unknown>[]
  labels: Record<string, unknown>[]
  attachments: {
    id: string
    message_id: string
    gmail_message_id: string
    gmail_attachment_id: string
    part_id: string
    filename: string
    mime_type: string
    size_bytes: number
    status: string
    attempts: number
    file_id: string | null
  }[]
  files: {
    id: string
    path: string
    mime: string
    size: number
    name: string
  }[]
  settings: { pubsub_topic: string | null }
  secrets: Record<string, string | null>
}

export function initialState(over: Partial<MailState> = {}): MailState {
  return {
    connection: {
      status: 'connected',
      reason: null,
      email: MAILBOX,
      scopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
      ],
      access: 'ya29.initial',
      refresh: '1//fake-refresh-initial',
      expiresAt: '2026-10-12T16:00:00.000Z',
    },
    sync: {
      history_id: null,
      lease_token: null,
      lease_until: null,
      initial_sync_done: false,
      initial_sync_page_token: null,
      watch_expires_at: null,
      sync_requested_at: null,
      last_sync_at: null,
      last_status: null,
      last_error: null,
      messages: 0,
    },
    upserted: [],
    deleted: [],
    labelChanges: [],
    labels: [],
    attachments: [],
    files: [],
    settings: { pubsub_topic: TOPIC },
    secrets: {
      google_oauth_client_id: FAKE_CLIENT_ID,
      google_oauth_client_secret: FAKE_CLIENT_SECRET,
      gmail_pubsub_token: PUBSUB_TOKEN,
    },
    ...over,
  }
}

/** The service double's RPC routes over `state`, `now` in ms. */
export function mailRpcRoutes(
  state: MailState,
  now: () => number,
  over: Record<string, RpcRoute> = {},
): Record<string, RpcRoute> {
  const ok = (data: unknown = null): FakeResult => ({ data })
  const syncRow = () => ({
    connection_id: CONNECTION_ID,
    email_address: state.connection?.email ?? MAILBOX,
    status: state.connection?.status ?? 'disconnected',
    history_id: state.sync.history_id === null
      ? null
      : Number(state.sync.history_id),
    sync_requested_at: state.sync.sync_requested_at,
    last_sync_at: state.sync.last_sync_at,
    initial_sync_done: state.sync.initial_sync_done,
    initial_sync_page_token: state.sync.initial_sync_page_token,
    watch_expires_at: state.sync.watch_expires_at,
    lease_until: state.sync.lease_until === null
      ? null
      : new Date(state.sync.lease_until).toISOString(),
  })
  let attachmentCounter = 0
  let fileCounter = 0
  return {
    consume_rate_limit: ok([{
      allowed: true,
      hits: 1,
      retry_after_seconds: 0,
    }]),
    module_enabled_for_org: ok(true),
    get_org_secret: (args) => ok(state.secrets[args.p_key as string] ?? null),
    get_communications_settings_for_org: () => ok(state.settings),
    get_mail_connection_credentials: () =>
      ok(
        state.connection && state.connection.status !== 'disconnected'
          ? [{
            connection_id: CONNECTION_ID,
            email_address: state.connection.email,
            kind: 'shared',
            status: state.connection.status,
            scopes: state.connection.scopes,
            access_token: state.connection.access,
            refresh_token: state.connection.refresh,
            access_token_expires_at: state.connection.expiresAt,
          }]
          : [],
      ),
    set_mail_access_token: (args) => {
      if (state.connection) {
        state.connection.access = args.p_access_token as string
        state.connection.expiresAt = args.p_expires_at as string
      }
      return ok()
    },
    set_mail_connection_status: (args) => {
      if (state.connection) {
        state.connection.status = args.p_status as string
        state.connection.reason = (args.p_reason as string | null) ?? null
      }
      return ok()
    },
    store_mail_connection: (args) => {
      state.connection = {
        status: 'connected',
        reason: null,
        email: args.p_email_address as string,
        scopes: args.p_scopes as string[],
        access: args.p_access_token as string,
        refresh: args.p_refresh_token as string,
        expiresAt: args.p_access_token_expires_at as string,
      }
      state.sync.sync_requested_at = new Date(now()).toISOString()
      return ok(CONNECTION_ID)
    },
    disconnect_mail_connection: () => {
      if (!state.connection || state.connection.status === 'disconnected') {
        return ok(false)
      }
      state.connection.status = 'disconnected'
      return ok(true)
    },
    request_mail_sync: (args) => {
      if (
        !state.connection || state.connection.status !== 'connected' ||
        state.connection.email !== String(args.p_email_address).toLowerCase()
      ) return ok(null)
      state.sync.sync_requested_at = new Date(now()).toISOString()
      return ok(CONNECTION_ID)
    },
    list_mail_connections_to_sync: () =>
      ok(
        state.connection && state.connection.status === 'connected'
          ? [syncRow()]
          : [],
      ),
    acquire_mail_sync_lease: (args) => {
      const s = state.sync
      if (
        s.lease_until !== null && s.lease_until >= now() &&
        s.lease_token !== args.p_token
      ) return ok(false)
      s.lease_token = args.p_token as string
      s.lease_until = now() + (args.p_seconds as number) * 1000
      return ok(true)
    },
    finish_mail_sync: (args) => {
      const s = state.sync
      if (s.lease_token !== args.p_token) return ok(false)
      s.lease_token = null
      s.lease_until = null
      if (args.p_history_id !== null && args.p_history_id !== undefined) {
        s.history_id = String(args.p_history_id)
      }
      s.last_status = args.p_status as string
      if (args.p_status === 'ok') {
        s.last_sync_at = new Date(now()).toISOString()
        s.last_error = null
      } else s.last_error = args.p_error_code as string
      if (typeof args.p_initial_sync_done === 'boolean') {
        s.initial_sync_done = args.p_initial_sync_done
      }
      s.initial_sync_page_token = s.initial_sync_done
        ? null
        : (args.p_initial_sync_page_token as string | null) ??
          s.initial_sync_page_token
      s.messages += args.p_messages as number
      return ok(true)
    },
    reset_mail_history: () => {
      state.sync.history_id = null
      state.sync.initial_sync_done = false
      state.sync.initial_sync_page_token = null
      return ok()
    },
    set_mail_watch: (args) => {
      state.sync.watch_expires_at = args.p_expires_at as string | null
      return ok()
    },
    upsert_mail_labels: (args) => {
      state.labels = args.p_labels as Record<string, unknown>[]
      return ok(state.labels.length)
    },
    upsert_mail_messages: (args) => {
      const rows = args.p_messages as Record<string, unknown>[]
      const out = rows.map((row) => {
        const known = state.upserted.find((u) =>
          u.gmail_message_id === row.gmail_message_id
        )
        state.upserted.push(row)
        const messageId = `00000000-0000-4000-8000-${
          String(state.upserted.length).padStart(12, '0')
        }`
        for (
          const a
            of (row.attachments as Record<string, unknown>[] | undefined) ?? []
        ) {
          if (!a.accepted || known) continue
          state.attachments.push({
            id: `00000000-0000-4000-8000-a${
              String(++attachmentCounter).padStart(11, '0')
            }`,
            message_id: messageId,
            gmail_message_id: row.gmail_message_id as string,
            gmail_attachment_id: a.gmail_attachment_id as string,
            part_id: a.part_id as string,
            filename: a.filename as string,
            mime_type: a.mime_type as string,
            size_bytes: a.size_bytes as number,
            status: 'pending',
            attempts: 0,
            file_id: null,
          })
        }
        return {
          message_id: messageId,
          gmail_message_id: row.gmail_message_id,
          inserted: !known,
        }
      })
      return ok(out)
    },
    delete_mail_messages: (args) => {
      const ids = args.p_gmail_message_ids as string[]
      state.deleted.push(...ids)
      return ok(ids.length)
    },
    apply_mail_label_changes: (args) => {
      const changes = args.p_changes as Record<string, unknown>[]
      state.labelChanges.push(...changes)
      return ok(changes.length)
    },
    list_mail_attachments_to_store: (args) =>
      ok(
        state.attachments.filter((a) =>
          a.status === 'pending' && a.attempts < 5
        ).slice(0, args.p_limit as number).map((a) => ({
          attachment_id: a.id,
          message_id: a.message_id,
          gmail_message_id: a.gmail_message_id,
          gmail_attachment_id: a.gmail_attachment_id,
          part_id: a.part_id,
          filename: a.filename,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          attempts: a.attempts,
        })),
      ),
    record_mail_attachment: (args) => {
      const a = state.attachments.find((x) => x.id === args.p_attachment_id)
      if (a) {
        a.status = args.p_status as string
        a.attempts++
        a.file_id = (args.p_stored_file_id as string | null) ?? a.file_id
      }
      return ok()
    },
    register_system_file: (args) => {
      const id = `00000000-0000-4000-8000-f${
        String(++fileCounter).padStart(11, '0')
      }`
      const path =
        `${args.p_org_id}/communications/${args.p_subject_id}/${id}.pdf`
      state.files.push({
        id,
        path,
        mime: args.p_mime_type as string,
        size: args.p_size_bytes as number,
        name: args.p_original_name as string,
      })
      return ok([{ file_id: id, object_path: path }])
    },
    discard_system_file: (args) => {
      state.files = state.files.filter((f) => f.id !== args.p_file_id)
      return ok(true)
    },
    claim_webhook_event: ok([{
      status: 'claimed',
      id: '00000000-0000-4000-8000-00000000e001',
      claim_token: '00000000-0000-4000-8000-00000000e002',
    }]),
    complete_webhook_event: ok(true),
    fail_webhook_event: ok(true),
    list_job_orgs: ok([ORG_ID]),
    start_job_run: (args) => ok(`run-${args.p_org_id}`),
    finish_job_run: ok(null),
    ...over,
  }
}

export interface GmailHarnessOptions {
  state?: MailState
  gmail?: FakeGmailOptions
  env?: Record<string, string | undefined>
  rpc?: Record<string, RpcRoute>
  /** The caller's permissions (the user client's `get_my_access`). */
  permissions?: string[]
  modules?: string[]
  /** No valid session: `auth.getUser` answers 401. */
  anonymous?: boolean
  now?: () => number
}

/** Everything a Gmail function test needs. */
export function gmailHarness(opts: GmailHarnessOptions = {}) {
  const state = opts.state ?? initialState()
  let clock = Date.parse(NOW)
  const now = opts.now ?? (() => clock)
  const google = fakeGmail({ emailAddress: MAILBOX, now, ...opts.gmail })
  const uploads: {
    bucket: string
    path: string
    size: number
    contentType: string
  }[] = []
  const service = fakeSupabase({
    rpc: mailRpcRoutes(state, now, opts.rpc),
    storage: {
      upload: (bucket, path, bytes, options) => {
        uploads.push({
          bucket,
          path: path as string,
          size: (bytes as Uint8Array).byteLength,
          contentType: (options as { contentType: string }).contentType,
        })
        return { data: { path } }
      },
    },
  })
  const user = fakeSupabase({
    ...(opts.anonymous ? {} : { user: { id: ADMIN_ID } }),
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(
            opts.permissions ??
              ['communications.mailboxes_manage', 'communications.inbox'],
          ),
          modules: opts.modules ?? ['communications'],
        },
      },
    },
  })
  const env: Record<string, string | undefined> = {
    APP_URL: 'http://localhost:5173',
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    GMAIL_API_BASE_URL: FAKE_ORIGIN,
    GOOGLE_OAUTH_BASE_URL: FAKE_ORIGIN,
    GOOGLE_ACCOUNTS_BASE_URL: FAKE_ORIGIN,
    GOOGLE_ACCOUNTS_PUBLIC_URL: 'http://127.0.0.1:55392',
    ...opts.env,
  }
  // The fake grants: the initial tokens of the state are known to Google.
  if (state.connection) {
    google.grants.set(state.connection.refresh, {
      scopes: state.connection.scopes,
      revoked: false,
    })
    google.tokens.set(state.connection.access, {
      expiresAt: Date.parse(state.connection.expiresAt),
      refresh: state.connection.refresh,
    })
  }
  return {
    state,
    google,
    service,
    user,
    uploads,
    env,
    deps: {
      env: (key: string) => env[key],
      fetch: google.fetch,
      now: () => new Date(now()),
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
