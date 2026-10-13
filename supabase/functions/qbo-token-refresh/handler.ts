/**
 * `qbo-token-refresh` (plan §8, FQ; job `billing.qbo_token_refresh`, daily
 * 07:17 UTC, maintenance): keeps the clinic's QuickBooks connection alive.
 * Intuit's refresh token lapses after 100 days without use and rotates at
 * each refresh; until the push runs (F1), nothing else uses it, so the job
 * refreshes once a day (`qboCredentials` with `force`: the new pair stored
 * encrypted, a concurrent rotation honoured).
 *
 * `runJob` verifies `X-Job-Signature` (PS Hub's cron sent the service-role
 * key, roadmap §2.6) and runs per org whose job and module are enabled.
 * Detail: « Connexion renouvelée » or « Aucune connexion QuickBooks »; an
 * Intuit refusal marks the connection `needs_reconnect` and fails the run
 * (`needs_reconnect`), which « Tâches planifiées » and Paramètres →
 * QuickBooks show.
 */
import type { Deps } from '../_shared/deps.ts'
import { type PerOrg, runJob } from '../_shared/jobs.ts'
import {
  NotConnected,
  oauthApp,
  qboCredentials,
  ReconnectNeeded,
} from '../_shared/qbo/credentials.ts'
import { qboOrigins } from '../_shared/qbo/env.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'qbo-token-refresh'
const JOB = 'billing.qbo_token_refresh'

const failure = (code: string) => Object.assign(new Error(code), { code })

/** The job's `perOrg`. */
export function refreshOrg(deps: Deps): PerOrg {
  return async (orgId, client, signal) => {
    const [app, connection] = await Promise.all([
      oauthApp(client, orgId),
      client.rpc('get_qbo_credentials', { p_org_id: orgId }),
    ])
    if (connection.error) throw failure('credentials_unavailable')
    if (!Array.isArray(connection.data) || connection.data.length === 0) {
      return 'Aucune connexion QuickBooks'
    }
    // A connection without the clinic's application cannot be refreshed: the run says so.
    if (!app) throw failure('not_configured')
    try {
      await qboCredentials(
        {
          client,
          fetch: deps.fetch,
          origins: qboOrigins(deps.env),
          now: deps.now,
          orgId,
          signal,
        },
        app,
        { force: true },
      )
      return 'Connexion renouvelée'
    } catch (error) {
      if (error instanceof NotConnected) return 'Aucune connexion QuickBooks'
      if (error instanceof ReconnectNeeded) throw failure('needs_reconnect')
      const raw = (error as { code?: unknown }).code
      const code = typeof raw === 'string' ? raw : 'refresh_failed'
      await reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)
      throw failure(code)
    }
  }
}

/** The job handler. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = refreshOrg(deps)
  return (req) => runJob(deps, req, JOB, perOrg)
}
