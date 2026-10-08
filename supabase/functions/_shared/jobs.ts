/**
 * The shared body of a scheduled function job (Task 3.3, design §8).
 *
 * `private.invoke_job_function` posts `{ job_key, org_id, trigger }` with
 * `Authorization: Bearer <internal secret>`. pg_net is asynchronous, so the
 * function writes its own outcome to `scheduled_job_runs`:
 *
 *   Deno.serve(createHandler(...)) → runJob(deps, req, 'core.x', perOrg)
 *
 * - cron: every org returned by `list_job_orgs` (job and module enabled, and the
 *   clinic's local hour for `local_hour` jobs); manual: the body's org only;
 * - per org: `start_job_run` (null = already ran this clinic day → skipped),
 *   `perOrg`, then `finish_job_run` (`ok` + its detail, or `error` + a code);
 * - orgs run one after the other (the only loop allowed, plan « Efficiency »);
 * - each `perOrg` is cut after `perOrgTimeoutMs` (60 s by default): the run is
 *   finished as `error` / `timeout`, its signal aborts, and the next org runs.
 *   The request must answer within the edge idle timeout (150 s, Supabase
 *   « Limits »; wall clock 150 s free / 400 s paid): a job over many orgs
 *   passes a lower value.
 *
 * `perOrg` returns a short detail (counts only, never personal data; capped at
 * 500 characters). A thrown error is recorded by its `code` when it is a safe
 * identifier, else `internal`: its message never reaches the run log.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { errorResponse, jsonResponse, verifyServiceRoleAuth } from './auth.ts'
import type { Deps } from './deps.ts'
import { readJson } from './http.ts'
import { reportError } from './report.ts'

/** `scheduled_job_runs.detail` is at most 500 characters (Task 3.3). */
const MAX_DETAIL = 500
/**
 * An error code safe to store and report. Upper case is allowed on purpose:
 * codes can be a SQLSTATE (`42P01`) or a PostgREST code (`PGRST202`).
 */
const SAFE_CODE = /^[A-Za-z0-9_]{1,64}$/
/** Default cap on one org's work (see the module comment). */
const PER_ORG_TIMEOUT_MS = 60_000

const jobRequestSchema = z.object({
  // Optional; when sent, it must name this function's job.
  job_key: z.string().optional(),
  // guid, not uuid: seed and fixture ids are not RFC 4122 variants.
  org_id: z.guid().nullish(),
  trigger: z.enum(['cron', 'manual']),
})

/**
 * One org's work: returns the run detail, or throws (ideally with a `code`).
 * `signal` aborts when the org's timeout fires: stop early when it does.
 */
export type PerOrg = (
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
) => Promise<string>

/** Options of `runJob`. */
export interface RunJobOptions {
  /** Cap on one org's `perOrg`, in ms (default 60 000). */
  perOrgTimeoutMs?: number
}

/** Thrown (internally) when an org's work outlives its timeout. */
const TIMEOUT = { code: 'timeout' } as const

/** `perOrg` raced against `timeoutMs`; rejects with `TIMEOUT` (and aborts) when it fires. */
async function withTimeout(
  perOrg: PerOrg,
  orgId: string,
  client: SupabaseClient,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController()
  let timer: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first: an abort listener may reject `work` synchronously.
      reject(TIMEOUT)
      controller.abort(TIMEOUT)
    }, timeoutMs)
  })
  try {
    const work = perOrg(orgId, client, controller.signal)
    // After a timeout, a late rejection is already recorded as `timeout`.
    work.catch(() => {})
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** The first `max` code points of `text` (never splits a surrogate pair). */
function truncate(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('')
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : 'internal'
}

/** Runs the job for one org; false when no run was started (skipped or failed). */
async function runForOrg(
  client: SupabaseClient,
  jobKey: string,
  orgId: string,
  trigger: 'cron' | 'manual',
  perOrg: PerOrg,
  timeoutMs: number,
): Promise<boolean> {
  // Assumed signature (Task 3.3, DB lane to confirm):
  // start_job_run(p_key text, p_org_id uuid, p_trigger text) returns uuid
  // → null when the job already ran for this clinic's local date.
  const start = await client.rpc('start_job_run', {
    p_key: jobKey,
    p_org_id: orgId,
    p_trigger: trigger,
  })
  if (start.error) {
    await reportError({
      fn: jobKey,
      code: 'job_run_start_failed',
      ids: { org_id: orgId },
    })
    return false
  }
  const runId: unknown = start.data
  if (typeof runId !== 'string') return false

  let status: 'ok' | 'error' = 'ok'
  let detail: string
  try {
    detail = truncate(
      await withTimeout(perOrg, orgId, client, timeoutMs),
      MAX_DETAIL,
    )
  } catch (error) {
    status = 'error'
    detail = errorCode(error)
    await reportError({
      fn: jobKey,
      code: detail,
      ids: { org_id: orgId, run_id: runId },
    })
  }
  // Assumed: finish_job_run(p_id uuid, p_status text, p_detail text) returns void.
  const finish = await client.rpc('finish_job_run', {
    p_id: runId,
    p_status: status,
    p_detail: detail,
  })
  if (finish.error) {
    await reportError({
      fn: jobKey,
      code: 'job_run_finish_failed',
      ids: { org_id: orgId, run_id: runId },
    })
  }
  return true
}

/** The orgs a cron run covers, or a 500 Response (reported). */
async function listJobOrgs(
  client: SupabaseClient,
  jobKey: string,
): Promise<string[] | Response> {
  // Assumed signature (Task 3.3, DB lane to confirm):
  // list_job_orgs(p_key text) returns setof uuid → PostgREST answers an array of strings.
  const { data, error } = await client.rpc('list_job_orgs', { p_key: jobKey })
  if (error || !Array.isArray(data)) {
    await reportError({ fn: jobKey, code: 'job_orgs_unavailable' })
    return errorResponse('internal', 'Job orgs unavailable', 500)
  }
  return data.filter((id): id is string => typeof id === 'string')
}

/**
 * Handles a job request: service-role auth, body `{ job_key?, org_id?, trigger }`,
 * then `perOrg` for each org (see the module comment). Answers 200 `{ runs }`,
 * the number of runs started; 400 for a bad body, a `job_key` other than
 * `jobKey`, or a manual run without an org; 500 when the org list cannot be read.
 */
export async function runJob(
  deps: Deps,
  req: Request,
  jobKey: string,
  perOrg: PerOrg,
  options: RunJobOptions = {},
): Promise<Response> {
  const denied = verifyServiceRoleAuth(req)
  if (denied) return denied
  const body = await readJson(req, jobRequestSchema)
  if (body instanceof Response) return body
  if (body.job_key !== undefined && body.job_key !== jobKey) {
    return errorResponse('invalid_request', 'job_key does not match', 400)
  }
  const manualOrg = body.trigger === 'manual' ? body.org_id : null
  if (body.trigger === 'manual' && !manualOrg) {
    return errorResponse('invalid_request', 'A manual run needs org_id', 400)
  }
  const client = deps.serviceClient()
  if (client instanceof Response) return client
  const orgs = manualOrg ? [manualOrg] : await listJobOrgs(client, jobKey)
  if (orgs instanceof Response) return orgs

  const timeoutMs = options.perOrgTimeoutMs ?? PER_ORG_TIMEOUT_MS
  let runs = 0
  for (const orgId of orgs) {
    if (
      await runForOrg(client, jobKey, orgId, body.trigger, perOrg, timeoutMs)
    ) runs++
  }
  return jsonResponse({ runs })
}
