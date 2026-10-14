/**
 * `google-calendar-sync` (R6, AP-42): the professionals' Google busy times.
 *
 * **Job mode** (a request carrying `X-Job-Signature`, job
 * `appointments.google_busy_sync`, every 15 minutes): `runJob` verifies the
 * signature, then per clinic (module `appointments` on) the connections due
 * (`list_calendar_connections_to_sync_for_service`: never synced, or not in
 * the last 10 minutes; 20 a run, one at a time) are synced (`syncConnection`).
 * The run's detail counts them by outcome (codes only).
 *
 * **User mode** (« Synchroniser », `{ action: 'sync' }`): `verifyAuth` with
 * module `appointments` and `appointments.self`; her own connection is synced
 * at once (one hit on `LIMITS.googleCalendarSyncUser`, 30 an hour). 200
 * `{ outcome }` (`synced`, `reconnect`, `error`); 404 when nothing is
 * connected; 503 `not_configured` without the Google application.
 *
 * Never a title: FreeBusy answers times only; nothing logs a time or an address.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { rpcErrorResponse } from '../_shared/errors.ts'
import { calendarOAuthApp } from '../_shared/google-calendar/credentials.ts'
import { syncConnection } from '../_shared/google-calendar/client.ts'
import { calendarOrigins } from '../_shared/google-calendar/env.ts'
import { readJson } from '../_shared/http.ts'
import { type PerOrg, runJob } from '../_shared/jobs.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'google-calendar-sync'
const JOB = 'appointments.google_busy_sync'
const PER_ORG_TIMEOUT_MS = 120_000
const BATCH = 20

const bodySchema = z.strictObject({ action: z.literal('sync') })
const credentialsSchema = z.array(
  z.object({ connection_id: z.string() }).loose(),
).max(1)

/** One clinic's run: its due connections, one at a time, until the deadline. */
export function syncOrg(deps: Deps): PerOrg {
  return async (orgId, client, signal) => {
    // A Response when Rendez-vous is off for the clinic (null: on).
    if (await requireModuleForOrg(client, orgId, 'appointments')) {
      return 'module_disabled'
    }
    const app = await calendarOAuthApp(client, orgId)
    if (!app) return 'not_configured'
    const due = await client.rpc(
      'list_calendar_connections_to_sync_for_service',
      { p_org_id: orgId, p_limit: BATCH },
    )
    if (due.error) {
      throw Object.assign(new Error('list_failed'), { code: 'list_failed' })
    }
    const ids = z.array(z.string()).safeParse(due.data)
    if (!ids.success) {
      throw Object.assign(new Error('list_unusable'), { code: 'list_unusable' })
    }
    const origins = calendarOrigins(deps.env)
    const counts: Record<string, number> = {}
    for (const id of ids.data) {
      if (signal.aborted) break
      const outcome = await syncConnection(
        { client, fetch: deps.fetch, origins, app, now: deps.now, signal },
        orgId,
        id,
      )
      const key = outcome.split(':')[0] ?? 'other'
      counts[key] = (counts[key] ?? 0) + 1
    }
    return Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(' ') ||
      'nothing_due'
  }
}

/** The handler (job or user mode); see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = syncOrg(deps)
  return async (req) => {
    if (req.headers.has('X-Job-Signature')) {
      return await runJob(deps, req, JOB, perOrg, {
        perOrgTimeoutMs: PER_ORG_TIMEOUT_MS,
      })
    }
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {
      module: 'appointments',
      permission: 'appointments.self',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, 256)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.googleCalendarSyncUser, [
        orgId,
        auth.user.id,
      ]),
      req,
    )
    if (limited) return limited

    let app
    try {
      app = await calendarOAuthApp(service, orgId)
    } catch {
      await report('oauth_app_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (!app) {
      return errorResponse('not_configured', 'Google app is not set', 503, req)
    }

    const read = await service.rpc('get_my_calendar_credentials_for_service', {
      p_actor: auth.user.id,
      p_org_id: orgId,
    })
    if (read.error) {
      if (read.error.code === '42501' || read.error.code === 'P0001') {
        return rpcErrorResponse(read.error, req)
      }
      await report('credentials_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const row = credentialsSchema.safeParse(read.data)
    if (!row.success) {
      await report('credentials_unusable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const connection = row.data[0]
    if (!connection) {
      return errorResponse('not_found', 'Nothing connected', 404, req)
    }
    ids.connection_id = connection.connection_id
    try {
      const outcome = await syncConnection(
        {
          client: service,
          fetch: deps.fetch,
          origins: calendarOrigins(deps.env),
          app,
          now: deps.now,
          signal: req.signal,
        },
        orgId,
        connection.connection_id,
      )
      const kind = outcome.split(':')[0]
      if (kind === 'gone') {
        return errorResponse('not_found', 'Nothing connected', 404, req)
      }
      return jsonResponse({ outcome: kind }, 200, req)
    } catch (error) {
      await report((error as { code?: string } | null)?.code ?? 'sync_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
  }
}
