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
 * 3. For each, in batches (one first, then 25 at a time): a new token in
 *    memory, `reissue_professional_invitation_for_service(org, id, hash)`
 *    (re-checks the rule under the file's lock and issues the link for the
 *    original inviter; null → skipped), then `professionals.invite_reminder`
 *    to the address the RPC returned, with the new link. The previous link is
 *    revoked by the re-issue: its raw token is gone, so a reminder always
 *    carries a new one.
 * 4. A send answered `not_configured` or `module_disabled` stops the clinic's
 *    run (`email_not_configured`) before any further link is re-issued: the
 *    first batch holds one file so that a broken email setup costs one link at
 *    most (P4-265). The run's timeout aborts the sends not yet queued.
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

type Outcome = 'reminded' | 'skipped' | 'failed' | 'stop'

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
      (orgId, client, signal) => remindOrg(deps, orgId, client, signal),
    )
}

async function remindOrg(
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
    const { data, error } = await client.rpc(
      'reissue_professional_invitation_for_service',
      {
        p_org: orgId,
        p_id: professionalId,
        p_token_hash: await hashToken(token),
      },
    )
    if (error) {
      await report('reissue_failed', professionalId)
      return 'failed'
    }
    if (data === null) return 'skipped'
    const row = reissuedSchema.safeParse(data)
    if (!row.success) {
      await report('reissue_invalid', professionalId)
      return 'failed'
    }
    try {
      const result = await sendTemplatedEmail(
        { fn: FN, client, env: deps.env, fetch: deps.fetch, signal },
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
      if (result.ok) return 'reminded'
      if (
        result.code === 'not_configured' || result.code === 'module_disabled'
      ) {
        return 'stop'
      }
      await report(`reminder_email_${result.code}`, professionalId)
      return 'failed'
    } catch (error) {
      // The send path reports its own failures before throwing them.
      if (!(error instanceof FunctionError)) {
        await report('unexpected', professionalId)
      }
      return 'failed'
    }
  }

  const counts = { reminded: 0, skipped: 0, failed: 0 }
  for (let start = 0; start < ids.length && !signal.aborted;) {
    const size = start === 0 ? 1 : BATCH_SIZE
    const outcomes = await Promise.all(
      ids.slice(start, start + size).map(remindOne),
    )
    start += size
    for (const outcome of outcomes) {
      if (outcome !== 'stop') counts[outcome]++
    }
    if (outcomes.includes('stop')) stop('email_not_configured')
  }
  return `listed=${ids.length} reminded=${counts.reminded} skipped=${counts.skipped} failed=${counts.failed}`
}
