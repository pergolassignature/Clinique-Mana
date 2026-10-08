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
 * - orgs run one after the other (the only loop allowed, plan « Efficiency »).
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
const SAFE_CODE = /^[A-Za-z0-9_]{1,64}$/

const jobRequestSchema = z.object({
  // guid, not uuid: seed and fixture ids are not RFC 4122 variants.
  org_id: z.guid().nullish(),
  trigger: z.enum(['cron', 'manual']),
})

/** One org's work: returns the run detail, or throws (ideally with a `code`). */
export type PerOrg = (orgId: string, client: SupabaseClient) => Promise<string>

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
    detail = (await perOrg(orgId, client)).slice(0, MAX_DETAIL)
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
 * Handles a job request: service-role auth, body `{ org_id?, trigger }`, then
 * `perOrg` for each org (see the module comment). Answers 200 `{ runs }`, the
 * number of runs started; 400 for a bad body or a manual run without an org;
 * 500 when the org list cannot be read.
 */
export async function runJob(
  deps: Deps,
  req: Request,
  jobKey: string,
  perOrg: PerOrg,
): Promise<Response> {
  const denied = verifyServiceRoleAuth(req)
  if (denied) return denied
  const body = await readJson(req, jobRequestSchema)
  if (body instanceof Response) return body
  const manualOrg = body.trigger === 'manual' ? body.org_id : null
  if (body.trigger === 'manual' && !manualOrg) {
    return errorResponse('invalid_request', 'A manual run needs org_id', 400)
  }
  const client = deps.serviceClient()
  if (client instanceof Response) return client
  const orgs = manualOrg ? [manualOrg] : await listJobOrgs(client, jobKey)
  if (orgs instanceof Response) return orgs

  let runs = 0
  for (const orgId of orgs) {
    if (await runForOrg(client, jobKey, orgId, body.trigger, perOrg)) runs++
  }
  return jsonResponse({ runs })
}
