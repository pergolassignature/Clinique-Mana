/**
 * `gmail-watch-renew` (plan §11, CM1; job `communications.gmail_watch_renew`,
 * hourly): keeps the Pub/Sub watch of every connected mailbox alive. Gmail
 * stops a watch after 7 days; `renewWatch` (`_shared/gmail/sync.ts`) renews
 * one that expires within 2 days, with the clinic's topic (the setting
 * `pubsub_topic`; without it the run says so and does nothing: the 15-minute
 * sync job is then the only trigger). The sync passes renew too; this job
 * is the belt to their braces, for a mailbox nothing synced for days.
 *
 * Per org (`runJob`): the topic, then each mailbox's credentials (an
 * `invalid_grant` marks it `needs_reconnect` and counts), `users.watch`
 * when due. Detail: « 2 boîtes : 1 renouvelée » (counts only). A refused
 * watch (`watch_refused`: a topic Gmail cannot publish to, the status doc's
 * IAM grant missing) fails the run with that code.
 */
import type { Deps } from '../_shared/deps.ts'
import { GmailClient } from '../_shared/gmail/client.ts'
import {
  mailboxCredentials,
  oauthApp,
  ReconnectNeeded,
} from '../_shared/gmail/credentials.ts'
import { gmailOrigins } from '../_shared/gmail/env.ts'
import {
  listMailboxes,
  pubsubTopic,
  renewWatch,
  type SyncContext,
} from '../_shared/gmail/sync.ts'
import { type PerOrg, runJob } from '../_shared/jobs.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'gmail-watch-renew'
const JOB = 'communications.gmail_watch_renew'

const failure = (code: string) => Object.assign(new Error(code), { code })

/** The job's `perOrg`. */
export function renewOrg(deps: Deps): PerOrg {
  return async (orgId, client, signal) => {
    const [mailboxes, topic, app] = await Promise.all([
      listMailboxes(client, orgId),
      pubsubTopic(client, orgId),
      oauthApp(client, orgId),
    ])
    if (mailboxes.length === 0) return 'Aucune boîte connectée'
    if (!topic) return 'Aucun sujet Pub/Sub configuré'
    if (!app) throw failure('not_configured')
    const origins = gmailOrigins(deps.env)
    const ctx: SyncContext = {
      client,
      fetch: deps.fetch,
      origins,
      now: deps.now,
      orgId,
      signal,
      softDeadline: Date.now() + 50_000,
      pubsubTopic: topic,
    }
    let renewed = 0
    let reconnect = 0
    let failed: string | null = null
    for (const mailbox of mailboxes) {
      if (signal.aborted) break
      try {
        const credentials = await mailboxCredentials(
          ctx,
          mailbox.connection_id,
          app,
        )
        const gmail = new GmailClient({
          fetch: deps.fetch,
          origin: origins.api,
          accessToken: credentials.accessToken,
          signal,
        })
        if (await renewWatch(ctx, gmail, mailbox, topic)) renewed++
      } catch (error) {
        if (error instanceof ReconnectNeeded) {
          reconnect++
          continue
        }
        const raw = (error as { code?: unknown }).code
        failed = typeof raw === 'string' ? raw : 'watch_failed'
        await reportError({
          fn: FN,
          code: failed,
          ids: { org_id: orgId, connection_id: mailbox.connection_id },
        }, deps.fetch)
      }
    }
    if (failed) throw failure(failed)
    const n = mailboxes.length
    const parts = [
      `${n} boîte${n > 1 ? 's' : ''} : ${renewed} renouvelée${
        renewed > 1 ? 's' : ''
      }`,
    ]
    if (reconnect > 0) parts.push(`${reconnect} à reconnecter`)
    return parts.join(', ')
  }
}

/** The job handler. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = renewOrg(deps)
  return (req) => runJob(deps, req, JOB, perOrg)
}
