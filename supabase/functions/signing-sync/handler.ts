/**
 * `signing-sync` (design §6.3, Task 3.33): reads a signature request back
 * from Documenso and applies what changed, in case a webhook was lost.
 *
 * **Job mode** (a request carrying `X-Job-Signature`, `core.signing_reconcile`,
 * hourly: the Documenso VM is not backed up, so a signed PDF whose webhook
 * was lost or failed must reach our storage within the hour,
 * `…_core_signing_capture.sql`): `runJob` verifies the signature, then
 * `reconcileOrg` per org (`_shared/signing-events.ts`, `perOrgTimeoutMs`
 * `RECONCILE_TIMEOUT_MS`, no new batch after `RECONCILE_SOFT_DEADLINE_MS`):
 * up to 100 listed requests, 4 at a time, those Documenso completed without
 * their PDF first, then the least recently attempted (a fair rotation: each
 * attempt is recorded, `record_signature_sync`); a request that fails is
 * counted and reported at most once a day, and only a real outage (nothing
 * read, Documenso unusable) fails the run; `sync` (every sent or viewed
 * request, completed without its PDF or not; a draft with a document whose send started
 * over an hour ago: claimed, read, then recovered when Documenso completed
 * it, else cancelled and abandoned), `expire` (sync first; still not
 * completed → expired here, then cancelled at Documenso, a 400 there
 * meaning Documenso expired it already) and `abandon` (a draft with no
 * document whose send started over a day ago, claimed first). A draft
 * whose send is under way is skipped (`sending`).
 *
 * **User mode** (« Synchroniser »):
 * 1. CORS; `POST` only; `verifyAuth` (an active profile).
 * 2. Body `{ request_id }`, strict.
 * 3. One hit on `LIMITS.signingSyncUser` (60 an hour per caller).
 * 4. `get_signature_request` with the **caller's** client: RLS decides (the
 *    caller's org and the request's view permission); no row → 404.
 * 5. The module gate: the request's module enabled for the caller (403
 *    `module_disabled`).
 * 6. The org's Documenso (none → 503 `not_configured`), then `syncRequest`
 *    without settling drafts: a draft whose send may be under way is never
 *    cancelled from a click (only a completed one is recovered, once
 *    claimed).
 * 7. For a sent or viewed request, the attempt is recorded like the
 *    reconcile's (`record_signature_sync`, best effort, nothing reported): a
 *    successful « Synchroniser » clears the request's « non vérifiée » state
 *    (`…_core_signing_blind_alert`), a failure records its code.
 * 8. 200 `{ request_id, outcome }` (`signed`, `updated`, `unchanged`,
 *    `orphan_completed`, `sending`).
 *
 * User-mode status codes: 200; 400 body; 401 / 403 / 503 from `verifyAuth`;
 * 403 `module_disabled`; 404 `not_found`; 405; 413; 429 `rate_limited`;
 * 502 `provider_error` (Documenso failed); 503 `not_configured` (no URL or
 * key, the key refused, or the limiter down); 500 `internal` (reported with
 * the org and request ids).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { DocumensoError } from '../_shared/documenso.ts'
import { readJson } from '../_shared/http.ts'
import { runJob } from '../_shared/jobs.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import {
  documensoReach,
  failureCode,
  type OrgSigning,
  orgSigning,
  RECONCILE_TIMEOUT_MS,
  reconcileOrg,
  recordAttempt,
  syncRequest,
} from '../_shared/signing-events.ts'

const FN = 'signing-sync'
const JOB = 'core.signing_reconcile'

const bodySchema = z.strictObject({ request_id: z.guid() })

const rowSchema = z.object({
  id: z.string(),
  module_key: z.string(),
  status: z.string(),
  documenso_document_id: z.string().nullable(),
  envelope_id: z.string().nullable(),
})

/** The sync handler (job or user mode); see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = reconcileOrg({ ...deps, reach: documensoReach(deps) }, FN)
  return async (req) => {
    if (req.headers.has('X-Job-Signature')) {
      return await runJob(deps, req, JOB, perOrg, {
        perOrgTimeoutMs: RECONCILE_TIMEOUT_MS,
      })
    }
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {}, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const orgId = auth.access.org_id
    const ids = { org_id: orgId, signature_request_id: input.request_id }
    const fail = async (code: string) => {
      await reportError({ fn: FN, code, ids }, deps.fetch)
      return errorResponse('internal', 'Sync failed', 500, req)
    }
    const failure = async (error: unknown) => {
      if (error instanceof DocumensoError) {
        return error.code === 'not_configured'
          ? errorResponse(
            'not_configured',
            'Documenso refused the key',
            503,
            req,
          )
          : errorResponse('provider_error', 'Documenso failed', 502, req)
      }
      const code = (error as { code?: unknown }).code
      return await fail(typeof code === 'string' ? code : 'sync_failed')
    }

    const limited = limitResponse(
      await consume(service, LIMITS.signingSyncUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

    const found = await auth.client.rpc('get_signature_request', {
      p_id: input.request_id,
    })
    if (found.error || !Array.isArray(found.data)) {
      return await fail('request_lookup_failed')
    }
    if (found.data.length === 0) {
      return errorResponse('not_found', 'Request not found', 404, req)
    }
    const row = rowSchema.safeParse(found.data[0])
    if (!row.success) return await fail('unexpected_request_row')
    // `core` is never disabled (it is not in org_modules).
    const moduleKey = row.data.module_key
    if (moduleKey !== 'core' && !auth.access.modules.includes(moduleKey)) {
      return errorResponse(
        'module_disabled',
        `Module disabled: ${moduleKey}`,
        403,
        req,
      )
    }

    let signing: OrgSigning | null
    try {
      signing = await orgSigning(
        service,
        orgId,
        deps.fetch,
        documensoReach(deps),
        req.signal,
      )
    } catch (error) {
      return await failure(error)
    }
    if (!signing) {
      return errorResponse(
        'not_configured',
        'Signing is not configured',
        503,
        req,
      )
    }
    // A sent or viewed request's read is recorded like the reconcile's
    // (`record_signature_sync`, nothing reported): a successful click clears
    // its « non vérifiée » state, a failed one counts. A draft's state is its
    // settle's, which a click never runs.
    const record = (code: string | null) =>
      row.data.status === 'draft'
        ? Promise.resolve()
        : recordAttempt(service, orgId, row.data.id, code, [], deps.fetch)
    try {
      const outcome = await syncRequest(
        {
          client: service,
          orgId,
          signing,
          now: deps.now,
          fn: FN,
          fetch: deps.fetch,
        },
        row.data,
        { settleDrafts: false },
      )
      await record(null)
      return jsonResponse({ request_id: row.data.id, outcome }, 200, req)
    } catch (error) {
      await record(failureCode(error))
      return await failure(error)
    }
  }
}
