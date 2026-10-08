/**
 * `professionals-invitation-reminders` (Task 4b.2, P4-45): the job
 * `professionals.invitation_reminders`, at 08:00 clinic time once per clinic
 * day. A job function (CLAUDE.md §7): `runJob` verifies `X-Job-Signature`
 * (never `verifyServiceRoleAuth`), lists the clinics (job and module enabled,
 * the local hour reached), and logs each clinic's run.
 *
 * Per clinic (`perOrg`):
 * 1. `APP_URL` must give invitation links (else the run fails
 *    `app_url_invalid`, nothing issued).
 * 2. `list_professional_invitations_to_remind_for_service(org, 100)`: the files
 *    whose invitation is due (the rule is in SQL: the clinic's delay, no
 *    account, not inactive, a live unopened link older than the delay, no
 *    reminder since that link, an inviter who still holds
 *    `professionals.invite`).
 * 3. For each, in batches: a new token in memory, then (unless the run's
 *    signal has already aborted: nothing is rotated after the timeout)
 *    `reissue_professional_invitation_for_service(org, id, hash)` (re-checks
 *    the rule under the file's lock and issues the link for the original
 *    inviter, bound to the file's address like every invitation, P4-300;
 *    null → skipped), then `professionals.invite_reminder` to the address
 *    the RPC returned, with the new link. The previous link is revoked by the
 *    re-issue: its raw token is gone, so a reminder always carries a new one.
 *    Once the link has rotated, the send is never aborted (no signal: the
 *    email is the only way the new link reaches the professional), as
 *    `professionals-submit` does.
 * 4. The stop rule (P4-265), so that a clinic-wide failure costs one link:
 *    - files are taken one at a time until a reminder has gone out (the
 *      probe: the first file, and the next ones while each is skipped or its
 *      address refused); during the probe any failure that is not the
 *      recipient's own (`invalid_recipient`) stops the run: the email setup
 *      (`not_configured`, `module_disabled` → `email_not_configured`), the
 *      provider (`provider_error`), the limits (`rate_limited`), the template
 *      (`missing_variable`), the re-issue or an internal error
 *      (`reminders_stopped_<code>`);
 *    - then batches of 25; after a batch, a `not_configured` /
 *      `module_disabled` send still stops the run (`email_not_configured`),
 *      and so do `provider_error` and `rate_limited`
 *      (`reminders_stopped_<code>`): a provider outage or the clinic's daily
 *      email quota would otherwise rotate every remaining link for nothing.
 *    A stopped run's failures are reported per file first (codes and ids).
 *    The run's timeout aborts the batches not yet started and the re-issues
 *    not yet made, never a send.
 * 5. The run's detail: `listed=… reminded=… skipped=… failed=…` (counts only).
 *
 * The token never leaves memory but for the email; reports carry the org and
 * professional ids and a code, never an address or a token.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { sendTemplatedEmail } from '../_shared/email/send.ts'
import { FunctionError } from '../_shared/errors.ts'
import { runJob } from '../_shared/jobs.ts'
import {
  appOrigin,
  generateToken,
  hashToken,
  linkUrl,
} from '../_shared/links.ts'
import { invitationValues } from '../_shared/professionals.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'professionals-invitation-reminders'
export const JOB_KEY = 'professionals.invitation_reminders'

/** Files reminded per clinic and run; the rest wait for the next day. */
export const MAX_PER_RUN = 100
/** Sends in flight at once, after the first file. */
export const BATCH_SIZE = 25

const idsSchema = z.array(z.guid()).max(MAX_PER_RUN)

/** `reissue_professional_invitation_for_service`'s answer. */
const reissuedSchema = z.object({
  email: z.string(),
  first_name: z.string(),
  expires_at: z.string(),
  clinic_name: z.string(),
})

/**
 * One file's outcome. `failed` carries the code of what went wrong: a send's
 * `SendFailureCode`, or `reissue_failed` / `reissue_invalid` / `internal`.
 * `aborted`: the run's signal fired before the re-issue, nothing rotated.
 */
type Outcome =
  | { kind: 'reminded' | 'skipped' | 'aborted' }
  | { kind: 'failed'; code: string }

/** A failure of the clinic's email setup: always ends the run. */
const SETUP_FAILURES = new Set(['not_configured', 'module_disabled'])
/** After the probe, these failures end the run too (P4-265). */
const BATCH_STOP_FAILURES = new Set(['provider_error', 'rate_limited'])

/** A failure that ends the clinic's run with this code (`runJob` records it). */
function stop(code: string): never {
  throw Object.assign(new Error(code), { code })
}

/** The run's code for a failure that stops it. */
function stopCode(failure: string): string {
  return SETUP_FAILURES.has(failure)
    ? 'email_not_configured'
    : `reminders_stopped_${failure}`
}

/** The job handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return (req) =>
    runJob(
      deps,
      req,
      JOB_KEY,
      (orgId, client, signal) => remindOrg(deps, orgId, client, signal),
    )
}

/** One clinic's run (`runJob`'s `perOrg`); exported for the abort tests. */
export async function remindOrg(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<string> {
  const appUrl = deps.env('APP_URL')?.trim() ?? ''
  if (!appOrigin(appUrl)) stop('app_url_invalid')

  const listed = await client.rpc(
    'list_professional_invitations_to_remind_for_service',
    { p_org: orgId, p_limit: MAX_PER_RUN },
  )
  const parsed = idsSchema.safeParse(listed.data)
  if (listed.error || !parsed.success) stop('reminders_list_failed')
  const ids = parsed.data

  const report = (code: string, professionalId: string) =>
    reportError(
      { fn: FN, code, ids: { org_id: orgId, professional_id: professionalId } },
      deps.fetch,
    )

  const remindOne = async (professionalId: string): Promise<Outcome> => {
    // In memory only: the token goes into the email, its hash to the RPC.
    const token = generateToken()
    const actionUrl = linkUrl(appUrl, '/invitation', token)
    const tokenHash = await hashToken(token)
    // The last point where the run's timeout may stop this file: past the
    // re-issue the old link is gone, and only the email carries the new one.
    if (signal.aborted) return { kind: 'aborted' }
    const { data, error } = await client.rpc(
      'reissue_professional_invitation_for_service',
      { p_org: orgId, p_id: professionalId, p_token_hash: tokenHash },
    )
    if (error) {
      await report('reissue_failed', professionalId)
      return { kind: 'failed', code: 'reissue_failed' }
    }
    if (data === null) return { kind: 'skipped' }
    const row = reissuedSchema.safeParse(data)
    if (!row.success) {
      await report('reissue_invalid', professionalId)
      return { kind: 'failed', code: 'reissue_invalid' }
    }
    try {
      // No signal: the link has rotated, so the send runs to its end.
      const result = await sendTemplatedEmail(
        { fn: FN, client, env: deps.env, fetch: deps.fetch },
        {
          orgId,
          templateKey: 'professionals.invite_reminder',
          to: { email: row.data.email, profileId: null },
          subject: { type: 'professional', id: professionalId },
          values: invitationValues({
            firstName: row.data.first_name,
            clinicName: row.data.clinic_name,
            expiresAt: row.data.expires_at,
          }),
          actionUrl,
          sentBy: null,
        },
      )
      if (result.ok) return { kind: 'reminded' }
      // A setup failure is the run's own code (`email_not_configured`).
      if (!SETUP_FAILURES.has(result.code)) {
        await report(`reminder_email_${result.code}`, professionalId)
      }
      return { kind: 'failed', code: result.code }
    } catch (error) {
      // The send path reports its own failures before throwing them.
      if (!(error instanceof FunctionError)) {
        await report('unexpected', professionalId)
      }
      return { kind: 'failed', code: 'internal' }
    }
  }

  const counts = { reminded: 0, skipped: 0, failed: 0 }
  // The probe: one file at a time until a reminder has gone out (step 4).
  let probing = true
  for (let start = 0; start < ids.length && !signal.aborted;) {
    const size = probing ? 1 : BATCH_SIZE
    const outcomes = await Promise.all(
      ids.slice(start, start + size).map(remindOne),
    )
    start += size
    const failures: string[] = []
    for (const outcome of outcomes) {
      if (outcome.kind === 'aborted') continue
      counts[outcome.kind]++
      if (outcome.kind === 'failed') failures.push(outcome.code)
    }
    const fatal = failures.find((code) =>
      SETUP_FAILURES.has(code) ||
      (probing ? code !== 'invalid_recipient' : BATCH_STOP_FAILURES.has(code))
    )
    if (fatal) stop(stopCode(fatal))
    if (counts.reminded > 0) probing = false
  }
  return `listed=${ids.length} reminded=${counts.reminded} skipped=${counts.skipped} failed=${counts.failed}`
}
