/**
 * `appointments-messages` (Rendez-vous R4): the job `appointments.messages`,
 * every 10 minutes. A job function (CLAUDE.md §7): `runJob` verifies
 * `X-Job-Signature`, lists the clinics (job and module enabled) and logs each
 * clinic's run.
 *
 * Per clinic:
 * 1. `requireModuleForOrg` (`appointments`).
 * 2. `appointment_messages_for_service`: the reminders due now are queued (on
 *    a business day, from the reminder hour: the next business day's
 *    appointments; their texts go through Communications at once), the stale
 *    emails set aside (cancelled, moved, past), and the pending emails listed
 *    (confirmations, reminders, changes, cancellations).
 * 3. Each email: a fresh token, `prepare_appointment_message_for_service` with
 *    its hash (null: it may no longer go, skipped), then the template
 *    `appointments.<kind>` (`_en` in English) with the confirmation link
 *    `/rendez-vous/confirmer#t=…` (none for a cancellation), then
 *    `finish_appointment_message_for_service`: sent, or tried again at the next
 *    pass (three tries, then failed; the link revoked). One after the other; a
 *    failure is counted and the others go on.
 * 4. The detail: counts only (`reminders=… emailed=… skipped=… failed=…`).
 *
 * Nothing logs or reports an address, a name or a token: reports carry ids.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { sendTemplatedEmail } from '../_shared/email/send.ts'
import { runJob } from '../_shared/jobs.ts'
import { generateToken, hashToken, linkUrl } from '../_shared/links.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'appointments-messages'
export const JOB_KEY = 'appointments.messages'
/** Emails per run and clinic. */
export const BATCH_LIMIT = 50

const passSchema = z.object({
  reminders: z.number().int().min(0),
  email: z.array(z.string()).max(200),
})

const preparedSchema = z.object({
  message_id: z.string(),
  appointment_id: z.string(),
  kind: z.enum(['confirmation', 'reminder', 'changed', 'cancelled']),
  language: z.enum(['fr', 'en']),
  email: z.string(),
  recipient_first_name: z.string(),
  client_first_name: z.string(),
  starts_at: z.string(),
  professional_name: z.string(),
  access: z.string(),
  clinic_name: z.string(),
  with_link: z.boolean(),
})

/** A failure that ends the clinic's run with this code. */
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
      (orgId, client, signal) => sendOrg(deps, orgId, client, signal),
    )
}

/** One clinic's run; exported for the tests. */
export async function sendOrg(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<string> {
  if (await requireModuleForOrg(client, orgId, 'appointments')) {
    stop('module_disabled')
  }
  const { data, error } = await client.rpc('appointment_messages_for_service', {
    p_org_id: orgId,
    p_limit: BATCH_LIMIT,
  })
  if (error) stop('pass_failed')
  const pass = passSchema.safeParse(data)
  if (!pass.success) stop('pass_invalid')

  let emailed = 0
  let skipped = 0
  let failed = 0
  for (const messageId of pass.data.email) {
    if (signal.aborted) stop('timeout')
    const report = (code: string) =>
      reportError(
        {
          fn: FN,
          code,
          ids: { org_id: orgId, appointment_message_id: messageId },
        },
        deps.fetch,
      )
    const token = generateToken()
    const { data: raw, error: prepareError } = await client.rpc(
      'prepare_appointment_message_for_service',
      {
        p_org_id: orgId,
        p_message_id: messageId,
        p_token_hash: await hashToken(token),
      },
    )
    if (prepareError) {
      failed++
      await report('prepare_failed')
      continue
    }
    if (raw === null) {
      skipped++
      continue
    }
    const prepared = preparedSchema.safeParse(raw)
    if (!prepared.success) {
      failed++
      await report('prepare_invalid')
      continue
    }
    const p = prepared.data
    let sent = false
    try {
      const result = await sendTemplatedEmail(
        { fn: FN, client, env: deps.env, fetch: deps.fetch },
        {
          orgId,
          templateKey: `appointments.${p.kind}${
            p.language === 'en' ? '_en' : ''
          }`,
          to: { email: p.email, profileId: null },
          subject: { type: 'appointment', id: p.appointment_id },
          values: {
            recipient: { first_name: p.recipient_first_name },
            client: { first_name: p.client_first_name },
            appointment: { starts_at: p.starts_at, access: p.access },
            professional: { name: p.professional_name },
            clinic: { name: p.clinic_name },
          },
          actionUrl: p.with_link
            ? linkUrl(
              deps.env('APP_URL') ?? '',
              '/rendez-vous/confirmer',
              token,
            )
            : null,
          sentBy: null,
        },
      )
      sent = result.ok
    } catch {
      // sendTemplatedEmail (or linkUrl's configuration check) reported it.
    }
    const { error: finishError } = await client.rpc(
      'finish_appointment_message_for_service',
      { p_org_id: orgId, p_message_id: messageId, p_sent: sent },
    )
    if (finishError) await report('finish_failed')
    if (sent) emailed++
    else failed++
  }
  return `reminders=${pass.data.reminders} emailed=${emailed} skipped=${skipped} failed=${failed}`
}
