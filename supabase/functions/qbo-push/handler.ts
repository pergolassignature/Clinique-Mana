/**
 * `qbo-push` (plan §8, FQ part 2; job `billing.qbo_push`, every 10 minutes,
 * off until enabled in « Tâches planifiées »): sends to QuickBooks what
 * Facturation issued, credited and cashed (F2's outbox) and the
 * professionals' invoices (FPay), per clinic (`_shared/qbo/push.ts`).
 *
 * `runJob` verifies `X-Job-Signature` and runs per org whose job and module
 * are on. Nothing is sent while the clinic's switch is « En pause » (the
 * default, FQ-6): the run says « En pause ». Detail: « En pause », « Aucune
 * connexion QuickBooks », « Rien à envoyer » or « 3 envoyés, 1 en attente,
 * 0 en échec ». A token Intuit refuses fails the run (`needs_reconnect`, the
 * connection marked); a document refused is recorded and retried later,
 * the run then `partial`.
 */
import type { Deps } from '../_shared/deps.ts'
import { type PerOrg, runJob } from '../_shared/jobs.ts'
import {
  NotConnected,
  oauthApp,
  ReconnectNeeded,
} from '../_shared/qbo/credentials.ts'
import { qboOrigins } from '../_shared/qbo/env.ts'
import { runQboPush } from '../_shared/qbo/push.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'qbo-push'
const JOB = 'billing.qbo_push'
/** Stop starting documents after this (the org's cap is 60 s). */
const BUDGET_MS = 45_000

const failure = (code: string) => Object.assign(new Error(code), { code })

/** The job's `perOrg`. */
export function pushOrg(deps: Deps): PerOrg {
  return async (orgId, client, signal) => {
    const app = await oauthApp(client, orgId)
    if (!app) return 'Aucune application Intuit'
    try {
      const result = await runQboPush({
        client,
        fetch: deps.fetch,
        origins: qboOrigins(deps.env),
        now: deps.now,
        orgId,
        signal,
        softDeadline: Date.now() + BUDGET_MS,
      }, app)
      if (result.status === 'paused') return 'En pause'
      if (result.status === 'not_connected') {
        return 'Aucune connexion QuickBooks'
      }
      if (result.pushed + result.waiting + result.failed === 0) {
        return 'Rien à envoyer'
      }
      const detail =
        `${result.pushed} envoyé(s), ${result.waiting} en attente, ${result.failed} en échec`
      if (result.failed > 0) {
        await reportError({
          fn: FN,
          code: result.firstError ?? 'push_failed',
          ids: { org_id: orgId },
        }, deps.fetch)
      }
      return detail
    } catch (error) {
      if (error instanceof NotConnected) return 'Aucune connexion QuickBooks'
      if (error instanceof ReconnectNeeded) throw failure('needs_reconnect')
      const raw = (error as { code?: unknown }).code
      const code = typeof raw === 'string' && /^[a-z_]{1,40}$/.test(raw)
        ? raw
        : 'push_failed'
      await reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)
      throw failure(code)
    }
  }
}

/** The job handler. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = pushOrg(deps)
  return (req) => runJob(deps, req, JOB, perOrg)
}
