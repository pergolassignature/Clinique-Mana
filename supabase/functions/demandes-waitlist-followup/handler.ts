/**
 * `demandes-waitlist-followup` (Demandes D3, D-17): the job
 * `demandes.waitlist_followup`, daily at 7 h clinic time. A job function
 * (CLAUDE.md §7): `runJob` verifies `X-Job-Signature`, lists the clinics (job
 * and module enabled) and logs each clinic's run.
 *
 * Per clinic:
 * 1. `requireModuleForOrg` (`demandes`).
 * 2. `waitlist_followup_for_service`: incomplete entries now settled become
 *    active; entries without news for the clinic's weeks (or whose next call
 *    is due) become « À rappeler », with one notice; « still waiting? » emails
 *    unanswered in time are noted « Sans réponse »; and, when the email is on
 *    and Demandes is open to everyone (P3-40), the entries to email.
 * 3. Each one (one per request): a fresh token,
 *    `prepare_waitlist_followup_for_service` with its hash (null: it may no
 *    longer go, skipped), then the email `demandes.waitlist_still_waiting`
 *    (`_en` in English) with the link `/liste-attente/reponse#t=…`, then
 *    `mark_waitlist_followup_sent_for_service`: sent → noted (the answer's
 *    clock starts), not sent → its link revoked and nothing noted, so the next
 *    pass tries again. One after the other; a failure is counted and the
 *    others go on.
 * 4. The detail: counts only
 *    (`promoted=… to_call=… no_answer=… emailed=… skipped=… failed=…`).
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

const FN = 'demandes-waitlist-followup'
export const JOB_KEY = 'demandes.waitlist_followup'
/** Emails per run and clinic. */
export const BATCH_LIMIT = 50

const passSchema = z.object({
  promoted: z.number().int().min(0),
  to_call: z.number().int().min(0),
  no_answer: z.number().int().min(0),
  email: z.array(z.string()).max(500),
})

const preparedSchema = z.object({
  demande_id: z.string(),
  email: z.string(),
  first_name: z.string().nullable(),
  language: z.enum(['fr', 'en']),
  clinic_name: z.string(),
  list_name: z.string().nullable(),
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
      (orgId, client, signal) => followUpOrg(deps, orgId, client, signal),
    )
}

/** One clinic's run; exported for the tests. */
export async function followUpOrg(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<string> {
  if (await requireModuleForOrg(client, orgId, 'demandes')) {
    stop('module_disabled')
  }
  const { data, error } = await client.rpc('waitlist_followup_for_service', {
    p_org_id: orgId,
    p_limit: BATCH_LIMIT,
  })
  if (error) stop('followup_failed')
  const pass = passSchema.safeParse(data)
  if (!pass.success) stop('followup_invalid')

  let emailed = 0
  let skipped = 0
  let failed = 0
  for (const entryId of pass.data.email) {
    if (signal.aborted) stop('timeout')
    const report = (code: string) =>
      reportError(
        { fn: FN, code, ids: { org_id: orgId, waitlist_entry_id: entryId } },
        deps.fetch,
      )
    const token = generateToken()
    const { data: raw, error: prepareError } = await client.rpc(
      'prepare_waitlist_followup_for_service',
      {
        p_org_id: orgId,
        p_entry_id: entryId,
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
          templateKey: p.language === 'en'
            ? 'demandes.waitlist_still_waiting_en'
            : 'demandes.waitlist_still_waiting',
          to: { email: p.email, profileId: null },
          subject: { type: 'demande', id: p.demande_id },
          values: {
            person: { first_name: p.first_name ?? '' },
            clinic: { name: p.clinic_name },
            waitlist: { name: p.list_name ?? '' },
          },
          actionUrl: linkUrl(
            deps.env('APP_URL') ?? '',
            '/liste-attente/reponse',
            token,
          ),
          sentBy: null,
        },
      )
      sent = result.ok
    } catch {
      // sendTemplatedEmail (or linkUrl's configuration check) reported it.
    }
    const { error: markError } = await client.rpc(
      'mark_waitlist_followup_sent_for_service',
      { p_org_id: orgId, p_entry_id: entryId, p_sent: sent },
    )
    if (markError) await report('mark_failed')
    if (sent) emailed++
    else failed++
  }
  const d = pass.data
  return `promoted=${d.promoted} to_call=${d.to_call} no_answer=${d.no_answer} emailed=${emailed} skipped=${skipped} failed=${failed}`
}
