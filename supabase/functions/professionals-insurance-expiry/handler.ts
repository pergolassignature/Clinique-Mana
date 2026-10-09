/**
 * `professionals-insurance-expiry` (Task 4c.4, P4-1, P4-45): the job
 * `professionals.insurance_expiry_notice`, at 06:00 clinic time once per
 * clinic day. A job function (CLAUDE.md §7): `runJob` verifies
 * `X-Job-Signature` (never `verifyServiceRoleAuth`), lists the clinics (job
 * and module enabled, the local hour reached), and logs each clinic's run.
 *
 * Per clinic (`perOrg`):
 * 1. `requireModuleForOrg` (the run fails `module_disabled` when the module is
 *    off: `start_job_run` already refuses it, this is the plan's second gate).
 * 2. `run_professionals_document_notices_for_service(org)`: one transaction
 *    in SQL (`*_professionals_insurance_expiry_job.sql`): verified documents
 *    past their last day become `expired`; the staff notices
 *    (`professionals.insurance_expiring`, `professionals.insurance_expired`,
 *    `professionals.documents_missing`) are created there with
 *    `private.notify`, deduplicated; it answers the emails due today, already
 *    deduplicated against `email_log` (one per reminder step, the expiry, then
 *    weekly), so a re-run the same day sends nothing twice. The professional
 *    stays active (P4-1): nothing here changes a status.
 * 3. The emails, in batches of 25 (`Promise.all`), to the professional's own
 *    address as the RPC returned it, subject `professional` / id, button
 *    « Mes documents » (`APP_URL/mes-documents`, behind sign-in, no token).
 *    A setup failure (`not_configured`, `module_disabled`) ends the run
 *    `email_not_configured`; a provider outage or the clinic's daily quota
 *    (`provider_error`, `rate_limited`) ends it `emails_stopped_<code>` after
 *    the batch; a refused address is counted and the others go on. A missed
 *    email is due again the next day (the RPC's dedupe ignores failures).
 * 4. The run's detail: counts only (`marked=… expiring=… expired=… missing=…
 *    emails=… sent=… failed=…`), never a name or an address (P4-410).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { sendTemplatedEmail } from '../_shared/email/send.ts'
import { FunctionError } from '../_shared/errors.ts'
import { runJob } from '../_shared/jobs.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import {
  appPageUrl,
  documentExpiryValues,
  MY_DOCUMENTS_PATH,
} from '../_shared/professionals.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'professionals-insurance-expiry'
export const JOB_KEY = 'professionals.insurance_expiry_notice'

/** Sends in flight at once. */
export const BATCH_SIZE = 25

const TEMPLATES = [
  'professionals.document_expiring',
  'professionals.document_expired',
  'professionals.document_expired_reminder',
] as const

/** `run_professionals_document_notices_for_service`'s answer. */
const runSchema = z.object({
  today: z.string(),
  clinic_name: z.string(),
  marked: z.number().int(),
  expiring: z.number().int(),
  expired: z.number().int(),
  missing: z.number().int(),
  emails: z.array(z.object({
    document_id: z.guid(),
    professional_id: z.guid(),
    profile_id: z.guid().nullable(),
    email: z.string(),
    first_name: z.string(),
    template_key: z.enum(TEMPLATES),
    expires_on: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  })).max(500),
})
type DueEmail = z.output<typeof runSchema>['emails'][number]

/** A failure of the clinic's email setup: always ends the run. */
const SETUP_FAILURES = new Set(['not_configured', 'module_disabled'])
/** These end the run after their batch: the rest would fail the same way. */
const BATCH_STOP_FAILURES = new Set(['provider_error', 'rate_limited'])

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
      (orgId, client, signal) => noticeOrg(deps, orgId, client, signal),
    )
}

/** One clinic's run (`runJob`'s `perOrg`); exported for the tests. */
export async function noticeOrg(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<string> {
  if (await requireModuleForOrg(client, orgId, 'professionals')) {
    stop('module_disabled')
  }
  const { data, error } = await client.rpc(
    'run_professionals_document_notices_for_service',
    { p_org: orgId },
  )
  if (error) stop('notices_failed')
  const parsed = runSchema.safeParse(data)
  if (!parsed.success) stop('notices_invalid')
  const run = parsed.data
  const counts =
    `marked=${run.marked} expiring=${run.expiring} expired=${run.expired} missing=${run.missing} emails=${run.emails.length}`
  if (run.emails.length === 0) return `${counts} sent=0 failed=0`

  // The notices are already in place; without an app URL only the emails wait.
  const actionUrl = appPageUrl(deps.env('APP_URL'), MY_DOCUMENTS_PATH)
  if (!actionUrl) stop('app_url_invalid')

  const sendOne = async (row: DueEmail): Promise<string | null> => {
    try {
      const result = await sendTemplatedEmail(
        { fn: FN, client, env: deps.env, fetch: deps.fetch, signal },
        {
          orgId,
          templateKey: row.template_key,
          to: { email: row.email, profileId: row.profile_id },
          subject: { type: 'professional', id: row.professional_id },
          values: documentExpiryValues({
            firstName: row.first_name,
            clinicName: run.clinic_name,
            expiresOn: row.expires_on,
          }),
          actionUrl,
          sentBy: null,
        },
      )
      if (result.ok) return null
      if (!SETUP_FAILURES.has(result.code)) {
        await reportError(
          {
            fn: FN,
            code: `expiry_email_${result.code}`,
            ids: { org_id: orgId, professional_id: row.professional_id },
          },
          deps.fetch,
        )
      }
      return result.code
    } catch (error) {
      // The send path reports its own failures before throwing them.
      if (!(error instanceof FunctionError)) {
        await reportError(
          {
            fn: FN,
            code: 'unexpected',
            ids: { org_id: orgId, professional_id: row.professional_id },
          },
          deps.fetch,
        )
      }
      return 'internal'
    }
  }

  let sent = 0
  let failed = 0
  for (let start = 0; start < run.emails.length; start += BATCH_SIZE) {
    if (signal.aborted) stop('timeout')
    const failures = (await Promise.all(
      run.emails.slice(start, start + BATCH_SIZE).map(sendOne),
    )).filter((code): code is string => code !== null)
    failed += failures.length
    sent += Math.min(BATCH_SIZE, run.emails.length - start) - failures.length
    if (failures.some((code) => SETUP_FAILURES.has(code))) {
      stop('email_not_configured')
    }
    const fatal = failures.find((code) => BATCH_STOP_FAILURES.has(code))
    if (fatal) stop(`emails_stopped_${fatal}`)
  }
  return `${counts} sent=${sent} failed=${failed}`
}
