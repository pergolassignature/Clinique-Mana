/**
 * `appointments-video-sync` (RZ): the job `appointments.video_sync`, every 5
 * minutes (`X-Job-Signature`, `runJob`). Per org (the module enabled):
 *
 * 1. **Tokens:** the Zoom connections whose tokens were refreshed more than
 *    20 hours ago are refreshed (Zoom's refresh token lapses after 90 days
 *    unused, and a revoked grant shows within a day). Zoom rotates the refresh
 *    token: both are stored again (`set_zoom_tokens_for_service`, retried
 *    twice: a rotated token never stored would end the grant), and only for the
 *    connection as the job read it (a reconnection meanwhile wins).
 * 2. **Meetings:** due tasks are claimed (`claim_video_tasks_for_service`,
 *    10 at a time, held 3 minutes, within a 90 s budget) and each
 *    appointment's meeting is made to match what it should be:
 *    - an appointment under way (`started`) keeps its meeting as it is: never
 *      moved or deleted under a session;
 *    - it wants one and her Zoom is connected: created, or moved when it
 *      exists on her account (a meeting gone at Zoom is made again). A
 *      creation retried after a failure first looks for the meeting Zoom may
 *      have made (same topic and start), so a lost answer never makes two;
 *    - it wants one, she is not connected, and its meeting is hers, on a
 *      connection waiting for a reconnection: kept (its link still works);
 *    - otherwise an existing meeting is deleted at Zoom (when its connection
 *      can still be used; else forgotten), and none is made.
 *    The result is recorded with `complete_video_task_for_service`, whatever
 *    happened: a failure keeps what was done and counts an attempt (three →
 *    `failed`, « Réessayer » in the agenda); `needs_reconnect` waits for the
 *    reconnection. A meeting made whose record fails is deleted again (best
 *    effort) before the run stops.
 * 3. **The link email:** when the completion says so (a new link of a future
 *    appointment, never emailed), « Votre lien de rencontre »
 *    (`appointments.video_link` / `_en`, by the contact's language) goes to
 *    each of the clients' contacts for appointments with an address; the link
 *    is marked emailed once one was sent (or there was nobody to send to).
 *
 * Access tokens are refreshed when they expire within 5 minutes, or once on a
 * 401. A refresh Zoom refuses, or a 401 a fresh token does not cure, marks the
 * connection `needs_reconnect` (the RPC tells the professional and the
 * staff). The run's detail counts only; reports carry ids only, never a
 * token, an address or a link.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { errorResponse } from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { sendTemplatedEmail } from '../_shared/email/send.ts'
import { type PerOrg, runJob } from '../_shared/jobs.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import { reportError } from '../_shared/report.ts'
import {
  type Meeting,
  type OAuthApp,
  oauthApp,
  ReconnectNeeded,
  refreshTokens,
  ZoomApi,
  ZoomError,
} from '../_shared/zoom/client.ts'
import { type ZoomOrigins, zoomOrigins } from '../_shared/zoom/env.ts'

const FN = 'appointments-video-sync'
export const JOB = 'appointments.video_sync'
/** The tasks' share of a run (the edge wall clock is 150 s). */
const BUDGET_MS = 90_000
const JOB_TIMEOUT_MS = 120_000
const BATCH = 10
const MAX_BATCHES = 10
/** An access token expiring within this is refreshed first. */
const REFRESH_AHEAD_MS = 5 * 60_000
/** Storing a rotated refresh token: tries in all. */
const STORE_TRIES = 3

const failure = (code: string) => Object.assign(new Error(code), { code })

/** The connection cannot be used any more (no tokens, ended, connected again meanwhile). */
class ConnectionGone extends Error {
  constructor() {
    super('connection_gone')
  }
}

const credentialsSchema = z.array(z.object({
  state: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  access_token_expires_at: z.string(),
  connected_at: z.string().nullable(),
})).max(1)

const taskSchema = z.object({
  appointment_id: z.string(),
  generation: z.number().int(),
  attempts: z.number().int(),
  wants_video: z.boolean(),
  started: z.boolean(),
  target_connection_id: z.string().nullable(),
  professional_id: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  timezone: z.string(),
  meeting_connection_id: z.string().nullable(),
  meeting_connection_state: z.string().nullable(),
  meeting_professional_id: z.string().nullable(),
  meeting_external_id: z.string().nullable(),
  meeting_join_url: z.string().nullable(),
})
type Task = z.infer<typeof taskSchema>

const recipientSchema = z.array(z.object({
  email: z.string(),
  first_name: z.string().nullable(),
  language: z.enum(['fr', 'en']),
  clinic_name: z.string(),
  professional_name: z.string().nullable(),
  starts_at: z.string(),
  join_url: z.string(),
}))

interface Context {
  deps: Deps
  client: SupabaseClient
  orgId: string
  app: OAuthApp | null
  origins: ZoomOrigins
  signal: AbortSignal
  /** Access tokens read (or refreshed) during this run, with the connection date they belong to. */
  tokens: Map<string, { access: string; connectedAt: string | null }>
}

/** The connection's access token; refreshed (and stored) when due or `force`d. */
async function accessToken(
  ctx: Context,
  connectionId: string,
  force = false,
): Promise<string> {
  const cached = ctx.tokens.get(connectionId)
  if (cached && !force) return cached.access
  if (!ctx.app) throw failure('not_configured')
  const read = await ctx.client.rpc('get_zoom_credentials_for_service', {
    p_org_id: ctx.orgId,
    p_connection_id: connectionId,
  })
  const parsed = credentialsSchema.safeParse(read.data)
  if (read.error || !parsed.success) throw failure('credentials_unavailable')
  const row = parsed.data[0]
  if (!row) throw new ConnectionGone()
  if (row.state !== 'connected') throw new ReconnectNeeded('invalid_grant')
  const expires = Date.parse(row.access_token_expires_at)
  if (
    !force && Number.isFinite(expires) &&
    expires - ctx.deps.now().getTime() > REFRESH_AHEAD_MS
  ) {
    ctx.tokens.set(connectionId, {
      access: row.access_token,
      connectedAt: row.connected_at,
    })
    return row.access_token
  }
  let token
  try {
    // Not the run's signal: once Zoom rotates the refresh token, the answer must be stored.
    token = await refreshTokens(
      ctx.deps.fetch,
      ctx.origins,
      ctx.app,
      row.refresh_token,
    )
  } catch (error) {
    if (error instanceof ReconnectNeeded) {
      await markReconnect(ctx, connectionId, error.reason, row.connected_at)
    }
    throw error
  }
  const args = {
    p_org_id: ctx.orgId,
    p_connection_id: connectionId,
    p_access_token: token.access_token,
    p_refresh_token: token.refresh_token,
    p_access_token_expires_at: new Date(
      ctx.deps.now().getTime() + (token.expires_in ?? 3_600) * 1000,
    ).toISOString(),
    p_connected_at: row.connected_at,
  }
  let stored = await ctx.client.rpc('set_zoom_tokens_for_service', args)
  for (let tries = 1; stored.error && tries < STORE_TRIES; tries++) {
    stored = await ctx.client.rpc('set_zoom_tokens_for_service', args)
  }
  if (stored.error) throw failure('tokens_not_stored')
  if (stored.data !== true) throw new ConnectionGone()
  ctx.tokens.set(connectionId, {
    access: token.access_token,
    connectedAt: row.connected_at,
  })
  return token.access_token
}

async function markReconnect(
  ctx: Context,
  connectionId: string,
  reason: ReconnectNeeded['reason'],
  connectedAt: string | null,
): Promise<void> {
  ctx.tokens.delete(connectionId)
  const marked = await ctx.client.rpc('mark_zoom_needs_reconnect_for_service', {
    p_org_id: ctx.orgId,
    p_connection_id: connectionId,
    p_reason: reason,
    p_connected_at: connectedAt,
  })
  if (marked.error) throw failure('reconnect_not_marked')
}

/** Runs `fn` with the connection's API; one refresh and retry on a 401. */
async function withApi<T>(
  ctx: Context,
  connectionId: string,
  fn: (api: ZoomApi) => Promise<T>,
): Promise<T> {
  const api = (token: string) =>
    new ZoomApi({
      fetch: ctx.deps.fetch,
      origin: ctx.origins.api,
      accessToken: token,
      signal: ctx.signal,
    })
  try {
    return await fn(api(await accessToken(ctx, connectionId)))
  } catch (error) {
    if (!(error instanceof ZoomError) || error.code !== 'unauthorized') {
      throw error
    }
  }
  try {
    return await fn(api(await accessToken(ctx, connectionId, true)))
  } catch (error) {
    if (error instanceof ZoomError && error.code === 'unauthorized') {
      const connectedAt = ctx.tokens.get(connectionId)?.connectedAt ?? null
      await markReconnect(ctx, connectionId, 'unauthorized', connectedAt)
      throw new ReconnectNeeded('unauthorized')
    }
    throw error
  }
}

/** What the task did, for the run's detail. */
type Outcome =
  | 'created'
  | 'moved'
  | 'deleted'
  | 'kept'
  | 'none'
  | 'waiting'
  | 'failed'

type HeldMeeting = Meeting & { connectionId: string }

interface Reconciled {
  outcome: Outcome
  meeting: HeldMeeting | null
  error: string | null
  /** The meeting this run made (deleted again if its record fails). */
  created: HeldMeeting | null
}

/** Makes one appointment's meeting match what it should be; returns the outcome and the final meeting. */
async function reconcile(ctx: Context, task: Task): Promise<Reconciled> {
  const times = {
    startsAt: task.starts_at,
    endsAt: task.ends_at,
    timezone: task.timezone,
  }
  let meeting: HeldMeeting | null =
    task.meeting_external_id && task.meeting_connection_id &&
      task.meeting_join_url
      ? {
        connectionId: task.meeting_connection_id,
        externalId: task.meeting_external_id,
        joinUrl: task.meeting_join_url,
      }
      : null
  const target = task.target_connection_id
  const hers = meeting !== null &&
    task.meeting_professional_id === task.professional_id
  let outcome: Outcome = 'none'
  let created: HeldMeeting | null = null
  try {
    if (meeting) {
      if (task.wants_video && hers && task.started) {
        // Under way: its link is the one the clients hold.
        return { outcome: 'kept', meeting, error: null, created }
      }
      if (task.wants_video && target === meeting.connectionId) {
        const current = meeting
        try {
          await withApi(
            ctx,
            target,
            (api) => api.updateMeeting(current.externalId, times),
          )
          return { outcome: 'moved', meeting, error: null, created }
        } catch (error) {
          if (!(error instanceof ZoomError) || error.code !== 'not_found') {
            throw error
          }
          meeting = null // Gone at Zoom: made again below.
        }
      } else if (
        task.wants_video && !target && hers &&
        task.meeting_connection_state === 'needs_reconnect'
      ) {
        return { outcome: 'kept', meeting, error: null, created }
      } else {
        if (task.meeting_connection_state === 'connected') {
          const current = meeting
          try {
            await withApi(
              ctx,
              current.connectionId,
              (api) => api.deleteMeeting(current.externalId),
            )
          } catch (error) {
            // Its connection ended or must be reconnected: the meeting can only be forgotten.
            if (
              !(error instanceof ConnectionGone) &&
              !(error instanceof ReconnectNeeded)
            ) throw error
          }
        }
        meeting = null
        outcome = 'deleted'
      }
    }
    if (task.wants_video && !task.started && target && !meeting) {
      const found = task.attempts > 0
        ? await withApi(ctx, target, (api) => api.findMeeting(times))
        : null
      const made = found ??
        await withApi(ctx, target, (api) => api.createMeeting(times))
      meeting = { ...made, connectionId: target }
      if (!found) created = meeting
      outcome = 'created'
    }
    return { outcome, meeting, error: null, created }
  } catch (error) {
    if (error instanceof ReconnectNeeded) {
      return { outcome: 'waiting', meeting, error: 'needs_reconnect', created }
    }
    if (error instanceof ConnectionGone) {
      return { outcome: 'waiting', meeting, error: 'connection_gone', created }
    }
    const code = error instanceof ZoomError
      ? `zoom_${error.code}`
      : ((error as { code?: unknown }).code === 'not_configured'
        ? 'not_configured'
        : 'internal')
    return { outcome: 'failed', meeting, error: code, created }
  }
}

/** « Votre lien de rencontre » to the appointment's contacts; the link marked emailed once one was sent. */
async function emailLink(
  ctx: Context,
  appointmentId: string,
  joinUrl: string,
): Promise<number> {
  const read = await ctx.client.rpc('video_link_email_for_service', {
    p_org_id: ctx.orgId,
    p_appointment_id: appointmentId,
  })
  const parsed = recipientSchema.safeParse(read.data)
  if (read.error || !parsed.success) throw failure('recipients_unavailable')
  const recipients = parsed.data.filter((r) => r.join_url === joinUrl)
  let sent = 0
  for (const r of recipients) {
    try {
      const result = await sendTemplatedEmail(
        {
          fn: FN,
          client: ctx.client,
          env: ctx.deps.env,
          fetch: ctx.deps.fetch,
          signal: ctx.signal,
        },
        {
          orgId: ctx.orgId,
          templateKey: r.language === 'en'
            ? 'appointments.video_link_en'
            : 'appointments.video_link',
          to: { email: r.email, profileId: null },
          subject: { type: 'appointment', id: appointmentId },
          values: {
            client: { first_name: r.first_name ?? '' },
            clinic: { name: r.clinic_name },
            appointment: {
              professional_name: r.professional_name ?? '',
              starts_at: r.starts_at,
            },
          },
          actionUrl: joinUrl,
          sentBy: null,
        },
      )
      if (result.ok) sent++
    } catch {
      // sendTemplatedEmail reported it (ids only); the other contacts still get theirs.
    }
  }
  // Every send failed: not marked, so the next completion with this link tries again.
  if (recipients.length > 0 && sent === 0) return 0
  const marked = await ctx.client.rpc('mark_video_link_emailed_for_service', {
    p_org_id: ctx.orgId,
    p_appointment_id: appointmentId,
    p_join_url: joinUrl,
  })
  if (marked.error) throw failure('link_not_marked')
  return sent
}

/** The job's `perOrg`; see the module comment. */
export function syncOrg(deps: Deps): PerOrg {
  return async (orgId, client, signal) => {
    if (await requireModuleForOrg(client, orgId, 'appointments')) {
      throw failure('module_disabled')
    }
    const softDeadline = Date.now() + BUDGET_MS
    let app: OAuthApp | null
    try {
      app = await oauthApp(client, orgId)
    } catch {
      throw failure('oauth_app_unavailable')
    }
    const ctx: Context = {
      deps,
      client,
      orgId,
      app,
      origins: zoomOrigins(deps.env),
      signal,
      tokens: new Map(),
    }
    const counts: Record<Outcome | 'refreshed' | 'emailed', number> = {
      created: 0,
      moved: 0,
      deleted: 0,
      kept: 0,
      none: 0,
      waiting: 0,
      failed: 0,
      refreshed: 0,
      emailed: 0,
    }

    if (app) {
      const due = await client.rpc(
        'list_zoom_connections_to_refresh_for_service',
        { p_org_id: orgId, p_limit: 20 },
      )
      if (due.error || !Array.isArray(due.data)) {
        throw failure('refresh_list_unavailable')
      }
      for (const id of due.data) {
        if (signal.aborted || typeof id !== 'string') break
        try {
          await accessToken(ctx, id, true)
          counts.refreshed++
        } catch (error) {
          // A refused grant is marked; Zoom down: the next run tries again.
          if (
            !(error instanceof ReconnectNeeded) &&
            !(error instanceof ConnectionGone)
          ) {
            await reportError({
              fn: FN,
              code: error instanceof ZoomError
                ? `refresh_${error.code}`
                : String(
                  (error as { code?: unknown }).code ?? 'refresh_failed',
                ),
              ids: { org_id: orgId, connection_id: id },
            }, deps.fetch)
          }
        }
      }
    }

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      if (signal.aborted || Date.now() > softDeadline) break
      const claimed = await client.rpc('claim_video_tasks_for_service', {
        p_org_id: orgId,
        p_limit: BATCH,
      })
      const tasks = z.array(taskSchema).safeParse(claimed.data)
      if (claimed.error || !tasks.success) throw failure('claim_failed')
      if (tasks.data.length === 0) break
      for (const task of tasks.data) {
        const result = await reconcile(ctx, task)
        counts[result.outcome]++
        const done = await client.rpc('complete_video_task_for_service', {
          p_org_id: orgId,
          p_appointment_id: task.appointment_id,
          p_generation: task.generation,
          p_connection_id: result.meeting?.connectionId ?? null,
          p_external_id: result.meeting?.externalId ?? null,
          p_join_url: result.meeting?.joinUrl ?? null,
          p_error_code: result.error,
        })
        if (done.error) {
          // A meeting made but not recorded would be made again: deleted (best effort) first.
          const made = result.created
          if (made) {
            await withApi(
              ctx,
              made.connectionId,
              (api) => api.deleteMeeting(made.externalId),
            ).catch(() => {})
          }
          throw failure('complete_failed')
        }
        if (result.error && result.outcome === 'failed') {
          await reportError({
            fn: FN,
            code: result.error,
            ids: { org_id: orgId, appointment_id: task.appointment_id },
          }, deps.fetch)
        }
        if (done.data === true && result.meeting) {
          counts.emailed += await emailLink(
            ctx,
            task.appointment_id,
            result.meeting.joinUrl,
          )
        }
      }
      if (tasks.data.length < BATCH) break
    }

    return `Réunions : ${counts.created} créées, ${counts.moved} déplacées, ${counts.deleted} supprimées, ${counts.kept} gardées ; ` +
      `en attente : ${counts.waiting} ; échecs : ${counts.failed} ; liens envoyés : ${counts.emailed} ; connexions renouvelées : ${counts.refreshed}`
  }
}

/** The handler (job mode only); see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = syncOrg(deps)
  return async (req) => {
    if (!req.headers.has('X-Job-Signature')) {
      return errorResponse('unauthenticated', 'Unauthorized', 401)
    }
    return await runJob(deps, req, JOB, perOrg, {
      perOrgTimeoutMs: JOB_TIMEOUT_MS,
    })
  }
}
