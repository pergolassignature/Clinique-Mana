/**
 * The Gmail sync of one mailbox (plan §11, CM1; ported from PS Hub's
 * `gmail-sync` with its flaws fixed, roadmap §2.4 bis), shared by
 * `gmail-sync` (« Synchroniser », the 15-minute job), `gmail-webhook` (after
 * a Pub/Sub notification) and `gmail-watch-renew` (the watch alone).
 *
 * One pass, under the mailbox's lease (`acquire_mail_sync_lease`, 5 min; a
 * second caller is `skipped`, nothing lost: the webhook's
 * `sync_requested_at` stays newer than `last_sync_at`):
 * 1. the access token (refreshed when needed; `invalid_grant` → the mailbox
 *    is `needs_reconnect` and the pass ends there);
 * 2. the labels (`upsert_mail_labels`);
 * 3. **the first pass** (no history id, or the 45-day listing not finished):
 *    the profile's history id is read **before** listing (so what arrives
 *    during a long first pass is caught by the history afterwards: PS Hub
 *    read it after), then `messages.list` `newer_than:45d` 100 ids a page,
 *    each page fetched `format=full` 8 at a time and written with
 *    `upsert_mail_messages`; the page token is saved when the time budget
 *    runs out, so the next run resumes (every run: the job, a webhook, a
 *    click). A message deleted meanwhile (404) is skipped;
 * 4. **the incremental pass** (`history.list` from the stored id): deleted
 *    ids → `delete_mail_messages`; label changes → `apply_mail_label_changes`
 *    from the records themselves (no re-fetch); added ids → fetched and
 *    written. The history id advances to the **largest record id applied**
 *    (never the profile's: PS Hub lost what landed in between); a page that
 *    fails stops the pass without advancing. A 404 / 410 (`history_gone`)
 *    forgets the id and runs the first pass again (the mirror keeps what it
 *    has: known messages are updated in place);
 * 5. the attachments still to copy (`list_mail_attachments_to_store`, 20 a
 *    pass): `attachments.get`, the bytes sniffed against the declared type
 *    (`_shared/storage.ts`), `register_system_file` + the upload to our
 *    bucket, `record_mail_attachment`; a failure is retried next pass (5
 *    attempts, then `failed`);
 * 6. the Pub/Sub watch, renewed when it expires within 2 days (needs the
 *    topic in the settings; without one, the 15-minute job is the only
 *    trigger);
 * 7. `finish_mail_sync` with the outcome (an error leaves the history id and
 *    records a code; the next pass repeats the work: every write is an
 *    upsert).
 *
 * Nothing here logs an address, a subject or a body: reports carry the org,
 * the connection and the message ids.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { forbiddenNameChar } from '../file-name.ts'
import {
  extensionForMime,
  sha256Hex,
  sniff,
  sniffMatchesMime,
} from '../storage.ts'
import {
  decodeBase64Url,
  GmailClient,
  GmailError,
  type GmailMessage,
} from './client.ts'
import {
  ConnectionGone,
  type CredentialsContext,
  mailboxCredentials,
  markReconnect,
  type OAuthApp,
  oauthApp,
  ReconnectNeeded,
} from './credentials.ts'
import { type GmailOrigins, REQUIRED_SCOPE } from './env.ts'
import { decodeBody, type ParsedMessage, parseMessage } from './mime.ts'

/** The first pass covers this many days (PS Hub: 45). */
export const INITIAL_DAYS = 45
/** Ids per list page and messages per `upsert_mail_messages` call. */
const PAGE = 100
const UPSERT_BATCH = 10
/** `messages.get` calls in flight. */
const FETCH_CONCURRENCY = 8
/** Attachments copied per pass. */
const ATTACHMENTS_PER_PASS = 20
/** The storage purpose's cap. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ATTACHMENT_MAX_ATTEMPTS = 5
/** The watch is renewed when it expires within this. */
const WATCH_RENEW_AHEAD_MS = 2 * 24 * 3_600_000
/** The lease taken for a pass. */
const LEASE_S = 300

/** What the caller gives the sync. */
export interface SyncContext {
  client: SupabaseClient
  fetch: typeof fetch
  origins: GmailOrigins
  now: () => Date
  orgId: string
  /** The caller's signal (a job's per-org timeout); the pass stops at the next step when it fires. */
  signal: AbortSignal
  /** Stop starting new pages after this moment (ms since epoch); the pass finishes cleanly. */
  softDeadline: number
  /** The Pub/Sub topic of the clinic's settings, or null (no watch). */
  pubsubTopic: string | null
}

/** One mailbox as `list_mail_connections_to_sync` lists it. */
export interface MailboxToSync {
  connection_id: string
  email_address: string
  status: string
  history_id: number | string | null
  sync_requested_at: string | null
  last_sync_at: string | null
  initial_sync_done: boolean
  initial_sync_page_token: string | null
  watch_expires_at: string | null
  lease_until: string | null
}

export const mailboxToSyncSchema = z.object({
  connection_id: z.string(),
  email_address: z.string(),
  status: z.string(),
  history_id: z.union([z.number(), z.string()]).nullable(),
  sync_requested_at: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  initial_sync_done: z.boolean(),
  initial_sync_page_token: z.string().nullable(),
  watch_expires_at: z.string().nullable(),
  lease_until: z.string().nullable(),
})

/** The outcome of one pass. */
export interface SyncOutcome {
  connectionId: string
  status: 'ok' | 'skipped' | 'needs_reconnect' | 'error'
  /** The failure's code when `error`. */
  code?: string
  messages: number
  deleted: number
  attachments: number
  /** The first pass is still under way (a page token was saved). */
  initialPending: boolean
  watchRenewed: boolean
}

/** A failure with a code `runJob` and the reports can carry. */
const failure = (code: string) => Object.assign(new Error(code), { code })

/** Compares two Gmail history ids (decimal strings, beyond 2^53 in theory). */
function maxHistoryId(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return BigInt(a) >= BigInt(b) ? a : b
}

const historyIdText = (value: number | string | null): string | null =>
  value === null || value === undefined ? null : String(value)

/** The mailboxes of an org a pass looks at. */
export async function listMailboxes(
  client: SupabaseClient,
  orgId: string,
): Promise<MailboxToSync[]> {
  const listed = await client.rpc('list_mail_connections_to_sync', {
    p_org_id: orgId,
  })
  const parsed = z.array(mailboxToSyncSchema).safeParse(listed.data)
  if (listed.error || !parsed.success) throw failure('mailboxes_unavailable')
  return parsed.data
}

/** The clinic's Pub/Sub topic (`org_module_settings`), or null. */
export async function pubsubTopic(
  client: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  // The settings are read as the service role: the same object the user RPC answers.
  const read = await client.rpc('get_communications_settings_for_org', {
    p_org_id: orgId,
  })
  if (read.error) return null
  const topic = (read.data as { pubsub_topic?: unknown } | null)?.pubsub_topic
  return typeof topic === 'string' && topic !== '' ? topic : null
}

async function rpcOrFail<T>(
  call: PromiseLike<{ data: unknown; error: unknown }>,
  schema: z.ZodType<T>,
  code: string,
): Promise<T> {
  const result = await call
  const parsed = schema.safeParse(result.data)
  if (result.error || !parsed.success) throw failure(code)
  return parsed.data
}

/** Runs `fn` over `items`, `limit` at a time, in order of completion. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}

/** The pass of one mailbox; see the module comment. Never throws for a mailbox's own failure. */
export async function syncMailbox(
  ctx: SyncContext,
  mailbox: MailboxToSync,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    connectionId: mailbox.connection_id,
    status: 'ok',
    messages: 0,
    deleted: 0,
    attachments: 0,
    initialPending: false,
    watchRenewed: false,
  }
  const token = crypto.randomUUID()
  const leased = await rpcOrFail(
    ctx.client.rpc('acquire_mail_sync_lease', {
      p_org_id: ctx.orgId,
      p_connection_id: mailbox.connection_id,
      p_token: token,
      p_seconds: LEASE_S,
    }),
    z.boolean(),
    'lease_unavailable',
  )
  if (!leased) return { ...outcome, status: 'skipped' }

  let historyId = historyIdText(mailbox.history_id)
  let initialDone = mailbox.initial_sync_done
  let pageToken: string | null = mailbox.initial_sync_page_token
  const finish = async (status: 'ok' | 'error', code: string | null) => {
    await ctx.client.rpc('finish_mail_sync', {
      p_org_id: ctx.orgId,
      p_connection_id: mailbox.connection_id,
      p_token: token,
      p_history_id: historyId,
      p_status: status,
      p_error_code: code,
      p_initial_sync_done: initialDone,
      p_initial_sync_page_token: pageToken,
      p_messages: outcome.messages,
    })
  }

  try {
    const app = await oauthApp(ctx.client, ctx.orgId)
    if (!app) throw failure('not_configured')
    const credentials = await mailboxCredentials(
      ctx as CredentialsContext,
      mailbox.connection_id,
      app,
    )
    if (!credentials.scopes.includes(REQUIRED_SCOPE)) {
      await markReconnect(
        ctx.client,
        ctx.orgId,
        mailbox.connection_id,
        'scope_missing',
      )
      throw new ReconnectNeeded('scope_missing')
    }
    const gmail = new GmailClient({
      fetch: ctx.fetch,
      origin: ctx.origins.api,
      accessToken: credentials.accessToken,
      signal: ctx.signal,
    })
    const budgetLeft = () =>
      !ctx.signal.aborted && Date.now() < ctx.softDeadline

    await syncLabels(ctx, gmail, mailbox.connection_id)

    const writeBatch = async (messages: GmailMessage[]) => {
      const parsed = await Promise.all(
        messages.map((m) => completeMessage(gmail, m, ctx.now())),
      )
      for (let i = 0; i < parsed.length; i += UPSERT_BATCH) {
        const rows = parsed.slice(i, i + UPSERT_BATCH).map(toRpcRow)
        await rpcOrFail(
          ctx.client.rpc('upsert_mail_messages', {
            p_org_id: ctx.orgId,
            p_connection_id: mailbox.connection_id,
            p_messages: rows,
          }),
          z.array(z.unknown()),
          'upsert_failed',
        )
        outcome.messages += rows.length
      }
    }

    /** Fetches ids `format=full`; a 404 is a message deleted meanwhile (skipped). */
    const fetchFull = (ids: string[]) =>
      mapLimit(ids, FETCH_CONCURRENCY, async (id) => {
        try {
          return await gmail.getMessage(id, 'full')
        } catch (error) {
          if (error instanceof GmailError && error.code === 'not_found') {
            return null
          }
          throw error
        }
      }).then((all) => all.filter((m): m is GmailMessage => m !== null))

    const initialPass = async () => {
      if (historyId === null) {
        const profile = await gmail.getProfile()
        historyId = profile.historyId ?? null
        if (historyId === null) throw failure('profile_unusable')
      }
      while (budgetLeft()) {
        const page = await gmail.listMessages({
          q: `newer_than:${INITIAL_DAYS}d`,
          maxResults: PAGE,
          pageToken: pageToken ?? undefined,
        })
        const ids = (page.messages ?? []).map((m) => m.id)
        if (ids.length > 0) await writeBatch(await fetchFull(ids))
        pageToken = page.nextPageToken ?? null
        if (pageToken === null) {
          initialDone = true
          return
        }
      }
      outcome.initialPending = true
    }

    const incrementalPass = async () => {
      // Fixed for the whole listing: Gmail ties a page token to the query that issued it, so
      // only the id saved at the end (`historyId`) moves forward, never the request's start.
      const startId = historyId!
      let token: string | undefined
      let applied: string | null = null
      let lastResponseId: string | null = null
      do {
        if (!budgetLeft()) break
        let page
        try {
          page = await gmail.listHistory({
            startHistoryId: startId,
            pageToken: token,
          })
        } catch (error) {
          if (error instanceof GmailError && error.code === 'history_gone') {
            // Under this pass's own lease: the reset is accepted.
            await ctx.client.rpc('reset_mail_history', {
              p_org_id: ctx.orgId,
              p_connection_id: mailbox.connection_id,
              p_token: token,
            })
            historyId = null
            initialDone = false
            pageToken = null
            await initialPass()
            return
          }
          throw error
        }
        lastResponseId = page.historyId ?? lastResponseId
        const added = new Set<string>()
        const deleted = new Set<string>()
        const changes = new Map<
          string,
          { add: Set<string>; remove: Set<string> }
        >()
        for (const record of page.history ?? []) {
          for (const a of record.messagesAdded ?? []) added.add(a.message.id)
          for (const d of record.messagesDeleted ?? []) {
            deleted.add(d.message.id)
          }
          for (
            const [list, key] of [[record.labelsAdded, 'add'], [
              record.labelsRemoved,
              'remove',
            ]] as const
          ) {
            for (const change of list ?? []) {
              const id = change.message.id
              const entry = changes.get(id) ??
                { add: new Set<string>(), remove: new Set<string>() }
              for (const label of change.labelIds ?? []) {
                entry[key].add(label)
                entry[key === 'add' ? 'remove' : 'add'].delete(label)
              }
              changes.set(id, entry)
            }
          }
          applied = maxHistoryId(applied, record.id)
        }
        for (const id of deleted) {
          added.delete(id)
          changes.delete(id)
        }
        if (deleted.size > 0) {
          const count = await rpcOrFail(
            ctx.client.rpc('delete_mail_messages', {
              p_org_id: ctx.orgId,
              p_connection_id: mailbox.connection_id,
              p_gmail_message_ids: [...deleted],
            }),
            z.number(),
            'delete_failed',
          )
          outcome.deleted += count
        }
        const labelChanges = [...changes].filter(([id]) => !added.has(id)).map((
          [id, c],
        ) => ({
          gmail_message_id: id,
          add: [...c.add],
          remove: [...c.remove],
        }))
        for (let i = 0; i < labelChanges.length; i += 500) {
          await rpcOrFail(
            ctx.client.rpc('apply_mail_label_changes', {
              p_org_id: ctx.orgId,
              p_connection_id: mailbox.connection_id,
              p_changes: labelChanges.slice(i, i + 500),
            }),
            z.number(),
            'labels_failed',
          )
        }
        if (added.size > 0) await writeBatch(await fetchFull([...added]))
        // The page is applied: the id advances to its last record (the response's when empty).
        historyId = maxHistoryId(
          historyId,
          applied ?? (page.nextPageToken ? null : lastResponseId),
        )
        token = page.nextPageToken
      } while (token)
    }

    if (historyId === null || !initialDone) await initialPass()
    else await incrementalPass()

    if (budgetLeft()) {
      outcome.attachments = await copyAttachments(
        ctx,
        gmail,
        mailbox.connection_id,
      )
    }
    if (!ctx.signal.aborted) {
      outcome.watchRenewed = (await renewWatch(
        ctx,
        gmail,
        mailbox,
        ctx.pubsubTopic,
      )) === 'renewed'
    }
    await finish('ok', null)
    return outcome
  } catch (error) {
    if (error instanceof ReconnectNeeded) {
      await finish('error', error.reason)
      return { ...outcome, status: 'needs_reconnect', code: error.reason }
    }
    if (error instanceof ConnectionGone) {
      await finish('error', 'connection_gone')
      return { ...outcome, status: 'error', code: 'connection_gone' }
    }
    const code = error instanceof GmailError
      ? `gmail_${error.code}`
      : typeof (error as { code?: unknown })?.code === 'string'
      ? (error as { code: string }).code
      : 'sync_failed'
    await finish('error', code)
    return { ...outcome, status: 'error', code }
  }
}

/** The mailbox's labels, replaced as a set. */
async function syncLabels(
  ctx: SyncContext,
  gmail: GmailClient,
  connectionId: string,
): Promise<void> {
  const listed = await gmail.listLabels()
  const labels = (listed.labels ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type === 'user' ? 'user' : 'system',
    visibility: l.labelListVisibility ?? null,
    color_background: l.color?.backgroundColor ?? null,
    color_text: l.color?.textColor ?? null,
  }))
  await rpcOrFail(
    ctx.client.rpc('upsert_mail_labels', {
      p_org_id: ctx.orgId,
      p_connection_id: connectionId,
      p_labels: labels,
    }),
    z.number(),
    'labels_failed',
  )
}

/** Parses a message and fetches the body parts Gmail hands out by attachment id. */
async function completeMessage(
  gmail: GmailClient,
  message: GmailMessage,
  now: Date,
): Promise<ParsedMessage> {
  const parsed = parseMessage(message, now)
  for (const ref of parsed.body_refs) {
    if (
      ref.kind === 'html'
        ? parsed.body_html !== null
        : parsed.body_text !== null
    ) continue
    try {
      const part = await gmail.getAttachment(message.id, ref.attachment_id)
      const text = decodeBody(decodeBase64Url(part.data), ref.charset)
      if (ref.kind === 'html') parsed.body_html = text.slice(0, 1_048_576)
      else parsed.body_text = text.slice(0, 1_048_576)
    } catch (error) {
      // A body part that cannot be read leaves the message without it (the snippet stays).
      if (!(error instanceof GmailError)) throw error
    }
  }
  if (parsed.body_html !== null) {
    for (const a of parsed.attachments) {
      a.is_inline = a.content_id !== null &&
        parsed.body_html.includes(`cid:${a.content_id}`)
    }
  }
  return parsed
}

/** The RPC's element (without the sync-only `body_refs`). */
function toRpcRow(m: ParsedMessage): Record<string, unknown> {
  const { body_refs: _refs, ...row } = m
  return row
}

/**
 * Mirrors one message now (`gmail-send`, CM3: the message just sent shows in
 * its thread at once, without waiting for the sync). Its attachments are
 * copied by the next pass, as any other's.
 */
export async function mirrorMessage(
  client: SupabaseClient,
  gmail: GmailClient,
  orgId: string,
  connectionId: string,
  gmailMessageId: string,
  now: Date,
): Promise<void> {
  const message = await gmail.getMessage(gmailMessageId, 'full')
  const parsed = await completeMessage(gmail, message, now)
  await rpcOrFail(
    client.rpc('upsert_mail_messages', {
      p_org_id: orgId,
      p_connection_id: connectionId,
      p_messages: [toRpcRow(parsed)],
    }),
    z.array(z.unknown()),
    'upsert_failed',
  )
}

const pendingSchema = z.array(z.object({
  attachment_id: z.string(),
  message_id: z.string(),
  gmail_message_id: z.string(),
  gmail_attachment_id: z.string().nullable(),
  part_id: z.string(),
  filename: z.string().nullable(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
  attempts: z.number(),
}))

const registeredSchema = z.array(
  z.object({ file_id: z.string(), object_path: z.string() }),
).length(1)

/** Copies the attachments still pending (at most 20): returns how many were stored. */
async function copyAttachments(
  ctx: SyncContext,
  gmail: GmailClient,
  connectionId: string,
): Promise<number> {
  const pending = await rpcOrFail(
    ctx.client.rpc('list_mail_attachments_to_store', {
      p_org_id: ctx.orgId,
      p_connection_id: connectionId,
      p_limit: ATTACHMENTS_PER_PASS,
    }),
    pendingSchema,
    'attachments_unavailable',
  )
  let stored = 0
  for (const item of pending) {
    if (ctx.signal.aborted || Date.now() >= ctx.softDeadline) break
    const record = (status: string, fileId: string | null = null) =>
      ctx.client.rpc('record_mail_attachment', {
        p_org_id: ctx.orgId,
        p_attachment_id: item.attachment_id,
        p_status: status,
        p_stored_file_id: fileId,
      })
    const mime = item.mime_type ?? ''
    if (!item.gmail_attachment_id || extensionForMime(mime) === null) {
      await record('unsupported_type')
      continue
    }
    if ((item.size_bytes ?? 0) > MAX_ATTACHMENT_BYTES) {
      await record('too_large')
      continue
    }
    const retryOrFail = async () => {
      await record(
        item.attempts + 1 >= ATTACHMENT_MAX_ATTEMPTS ? 'failed' : 'pending',
      )
    }
    let bytes: Uint8Array
    try {
      const part = await gmail.getAttachment(
        item.gmail_message_id,
        item.gmail_attachment_id,
      )
      bytes = decodeBase64Url(part.data)
    } catch (error) {
      if (
        error instanceof GmailError &&
        (error.code === 'not_found' || error.code === 'too_large')
      ) {
        await record(error.code === 'too_large' ? 'too_large' : 'failed')
        continue
      }
      await retryOrFail()
      continue
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      await record(bytes.byteLength === 0 ? 'failed' : 'too_large')
      continue
    }
    if (!sniffMatchesMime(sniff(bytes), mime)) {
      // The bytes are not what the part declares (a polyglot, a mislabelled file): kept in Gmail only.
      await record('unsupported_type')
      continue
    }
    const registered = await ctx.client.rpc('register_system_file', {
      p_org_id: ctx.orgId,
      p_bucket: 'documents',
      p_module_key: 'communications',
      p_purpose: 'mail_attachment',
      p_subject_type: 'mail_message',
      p_subject_id: item.message_id,
      p_mime_type: mime,
      p_size_bytes: bytes.byteLength,
      p_sha256: sha256Hex(bytes),
      p_view_permission: null,
      p_original_name: safeFileName(item.filename, mime),
    })
    const file = registeredSchema.safeParse(registered.data)
    if (registered.error || !file.success) {
      await retryOrFail()
      continue
    }
    const { file_id, object_path } = file.data[0]
    const upload = await ctx.client.storage.from('documents').upload(
      object_path,
      bytes,
      {
        contentType: mime,
        upsert: false,
      },
    )
    if (upload.error) {
      await ctx.client.rpc('discard_system_file', {
        p_org_id: ctx.orgId,
        p_file_id: file_id,
      })
      await retryOrFail()
      continue
    }
    const recorded = await record('stored', file_id)
    if (recorded.error) {
      await ctx.client.rpc('discard_system_file', {
        p_org_id: ctx.orgId,
        p_file_id: file_id,
      })
      continue
    }
    stored++
  }
  return stored
}

/** A file name the registry accepts (`forbiddenNameChar`: no `/`, `\`, control or bidi characters), with a fallback. */
export function safeFileName(name: string | null, mime: string): string {
  const cleaned = Array.from(name ?? '').map((c) =>
    forbiddenNameChar(c) ? ' ' : c
  ).join('')
    .replace(/\s+/g, ' ').trim().slice(0, 200)
  if (cleaned !== '') return cleaned
  return `piece-jointe.${extensionForMime(mime) ?? 'bin'}`
}

/**
 * Renews the mailbox's Pub/Sub watch when it is missing or expires within 2
 * days and a topic is set: `renewed`, or `not_due` (no topic, or not yet).
 * A refused watch (a topic Gmail cannot publish to: a wrong name, or
 * `gmail-api-push@…` not a publisher) is `refused`, never thrown: a sync pass
 * goes on (the mail is still read, and « Courriels Gmail » shows the mailbox
 * as not watched while a topic is set); `gmail-watch-renew` fails its run
 * with `watch_refused`, so « Tâches planifiées » says so.
 */
export async function renewWatch(
  ctx: SyncContext,
  gmail: GmailClient,
  mailbox: Pick<MailboxToSync, 'connection_id' | 'watch_expires_at'>,
  topic: string | null,
): Promise<'renewed' | 'not_due' | 'refused'> {
  if (!topic) return 'not_due'
  const expires = mailbox.watch_expires_at
    ? Date.parse(mailbox.watch_expires_at)
    : NaN
  if (
    Number.isFinite(expires) &&
    expires - ctx.now().getTime() > WATCH_RENEW_AHEAD_MS
  ) return 'not_due'
  let result
  try {
    result = await gmail.watch(topic)
  } catch (error) {
    if (
      error instanceof GmailError &&
      (error.code === 'bad_request' || error.code === 'forbidden')
    ) {
      return 'refused'
    }
    throw error
  }
  const expiresAt = new Date(Number(result.expiration))
  await rpcOrFail(
    ctx.client.rpc('set_mail_watch', {
      p_org_id: ctx.orgId,
      p_connection_id: mailbox.connection_id,
      p_expires_at: Number.isFinite(expiresAt.getTime())
        ? expiresAt.toISOString()
        : null,
      p_history_id: result.historyId ?? null,
    }),
    z.unknown(),
    'watch_record_failed',
  )
  return 'renewed'
}

/** « 2 boîtes : 12 messages, 1 pièce jointe » (counts only, never an address). */
export function syncDetail(outcomes: SyncOutcome[]): string {
  const boxes = outcomes.length
  const messages = outcomes.reduce((n, o) => n + o.messages, 0)
  const attachments = outcomes.reduce((n, o) => n + o.attachments, 0)
  const skipped = outcomes.filter((o) => o.status === 'skipped').length
  const reconnect =
    outcomes.filter((o) => o.status === 'needs_reconnect').length
  const errors = outcomes.filter((o) => o.status === 'error').map((o) =>
    o.code ?? 'error'
  )
  const parts = [
    `${boxes} boîte${boxes > 1 ? 's' : ''} : ${messages} message${
      messages > 1 ? 's' : ''
    }`,
    `${attachments} pièce${attachments > 1 ? 's' : ''} jointe${
      attachments > 1 ? 's' : ''
    }`,
  ]
  if (skipped > 0) parts.push(`${skipped} déjà en cours`)
  if (reconnect > 0) parts.push(`${reconnect} à reconnecter`)
  if (errors.length > 0) parts.push(`erreurs : ${errors.join(', ')}`)
  return parts.join(', ')
}

/** The outcomes an org's run should report as a failure: a provider or database error (not a reconnection or a skip). */
export function runFailureCode(outcomes: SyncOutcome[]): string | null {
  const failed = outcomes.find((o) => o.status === 'error')
  return failed?.code ?? null
}

export type { OAuthApp }
