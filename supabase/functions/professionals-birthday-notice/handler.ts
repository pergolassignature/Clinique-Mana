/**
 * `professionals-birthday-notice` (P4-564): the job
 * `professionals.birthday_notice`, at 07:00 clinic time once per clinic day,
 * off until « Tâches planifiées » switches it on (like every business job). A
 * job function (CLAUDE.md §7): `runJob` verifies `X-Job-Signature` (never a
 * bearer key), lists the clinics (job and module enabled, the local hour
 * reached), and logs each clinic's run.
 *
 * Per clinic (`perOrg`):
 * 1. `requireModuleForOrg` (the run fails `module_disabled` when the module is
 *    off: `start_job_run` already refuses it, this is the second gate).
 * 2. `run_professionals_birthday_notices_for_service(org)`: one statement in
 *    SQL (`*_professionals_birthday.sql`) notifies `professionals.manage` of
 *    each active professional whose birthday is the clinic's today, through
 *    `private.notify`, deduplicated per professional and day: a manual
 *    « Exécuter maintenant » or a second run the same day adds nothing.
 * 3. The run's detail: a count only (`birthdays=N`), never a name.
 *
 * No email: the notice is for the clinic's team, in the bell.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { runJob } from '../_shared/jobs.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'

export const JOB_KEY = 'professionals.birthday_notice'

/** A failure that ends the clinic's run with this code (`runJob` records it). */
function stop(code: string): never {
  throw Object.assign(new Error(code), { code })
}

/** The job handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return (req) =>
    runJob(
      deps,
      req,
      JOB_KEY,
      (orgId, client) => noticeOrg(orgId, client),
    )
}

/** One clinic's run (`runJob`'s `perOrg`); exported for the tests. */
export async function noticeOrg(
  orgId: string,
  client: SupabaseClient,
): Promise<string> {
  if (await requireModuleForOrg(client, orgId, 'professionals')) {
    stop('module_disabled')
  }
  const { data, error } = await client.rpc(
    'run_professionals_birthday_notices_for_service',
    { p_org_id: orgId },
  )
  if (error) stop('notices_failed')
  const parsed = z.number().int().min(0).safeParse(data)
  if (!parsed.success) stop('notices_invalid')
  return `birthdays=${parsed.data}`
}
