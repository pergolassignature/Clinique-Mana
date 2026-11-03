/**
 * `clients-consent-professional-sign` (Clients C5a, decision CC-22): the
 * professional assigned to the file countersigns a client consent **in the
 * app**, authenticated — no secure link, no email, no identity check, as she
 * already signs her own « Consentement au droit à l'image » (P4-487).
 *
 * It **never renders and never creates an envelope**: the clauses printed in
 * the document are the client's answers (R-46), so the client answers and
 * signs first and this function only resumes the envelope already out. That is
 * why it imports the render-free `_shared/signing-events.ts` and not
 * `_shared/signing.ts` (ADR 0008, `isolation.test.ts`).
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `clients` and
 *    `clients.self`.
 * 2. Body `{ request_id }` (the consent request): nothing else is read from it
 *    — the signer, the envelope and her recipient come from the database.
 * 3. One hit on `LIMITS.clientConsentProfessionalSignUser` (20 an hour per
 *    caller).
 * 4. `prepare_my_client_consent_signature_for_service` with the **service**
 *    client and `p_actor` = the caller `verifyAuth` verified: her own signer
 *    row only (P0001 refusals with a HINT: `professional`, `request`, `state`,
 *    `signed`; 42501 → 403).
 * 5. `{ state: 'waiting' }` → 200 `{ state: 'waiting' }`: the client has not
 *    signed yet, so there is nothing to countersign and the page says so.
 * 6. `{ state: 'resume' }` → her signing token read again from Documenso
 *    (`signingToken`), then 200
 *    `{ state: 'ready', request_id, token, signing_url, host }`. The token and
 *    the URL are **credentials**, returned once, never stored, logged,
 *    reported nor cached (`Cache-Control: no-store`); the page keeps them in
 *    component state for `EmbedSignDocument` (`host`, `token`) or the redirect
 *    fallback (`signing_url`).
 *
 * There is no `sync` action: the webhook completes the request, as it does for
 * the public page, and staff still have « Synchroniser » (`signing-sync`). The
 * page refetches `my_client_consent_signatures` after signing.
 *
 * `host` is the clinic's Documenso address (`signing_settings.base_url`);
 * locally only (`APP_URL` local), `DOCUMENSO_PUBLIC_URL` replaces it, since the
 * functions reach the fake as `host.docker.internal` and the browser as
 * `127.0.0.1`.
 *
 * Status codes: 200; 400 `invalid_request` (body, or a P0001 refusal);
 * 401 / 403 / 503 from `verifyAuth`; 403 (42501); 405; 413; 429; 502
 * `provider_error` (Documenso failed); 503 `not_configured`; 500 `internal`
 * (reported with the org and request ids only).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  isLocalAppUrl,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import { consentRpcError } from '../_shared/client-consents.ts'
import type { Deps } from '../_shared/deps.ts'
import { DocumensoError } from '../_shared/documenso.ts'
import { isExpectedRpcError } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import {
  documensoReach,
  orgSigning,
  signingCredentials,
  SigningFailure,
} from '../_shared/signing-events.ts'

const FN = 'clients-consent-professional-sign'

const bodySchema = z.strictObject({
  request_id: z.uuid(),
})

const preparedSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('waiting') }),
  z.object({
    state: z.literal('resume'),
    org_id: z.string(),
    request_id: z.string(),
    envelope_id: z.string(),
    recipient_id: z.string(),
  }),
])

/** The answer that carries a credential: never cached. */
function noStore(body: unknown, req: Request): Response {
  const res = jsonResponse(body, 200, req)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** The countersignature handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { module: 'clients', permission: 'clients.self' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const { org_id: orgId, user_id: actor } = auth.access
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError({ fn: FN, code, ids: { org_id: orgId, ...ids } }, deps.fetch)

    const limited = limitResponse(
      await consume(
        service,
        LIMITS.clientConsentProfessionalSignUser,
        [orgId, actor],
      ),
      req,
    )
    if (limited) return limited

    const prepared = await service.rpc(
      'prepare_my_client_consent_signature_for_service',
      {
        p_org_id: orgId,
        p_actor: actor,
        p_request_id: input.request_id,
      },
    )
    if (prepared.error) {
      if (!isExpectedRpcError(prepared.error)) await report('prepare_failed')
      return consentRpcError(prepared.error, req)
    }
    const parsed = preparedSchema.safeParse(prepared.data)
    if (!parsed.success) {
      await report('prepare_invalid', {
        client_consent_request_id: input.request_id,
      })
      return errorResponse('internal', 'Countersignature failed', 500, req)
    }
    // The client has not answered and signed yet: nothing to countersign.
    if (parsed.data.state === 'waiting') {
      return jsonResponse({ state: 'waiting' }, 200, req)
    }
    const { request_id: requestId, envelope_id, recipient_id } = parsed.data

    try {
      const credentials = await signingCredentials(service, orgId)
      const appUrl = deps.env('APP_URL') ?? ''
      const localUrl = deps.env('DOCUMENSO_PUBLIC_URL')
      const base = isLocalAppUrl(appUrl) && localUrl
        ? localUrl
        : credentials.base_url
      const signing = await orgSigning(
        service,
        orgId,
        deps.fetch,
        documensoReach(deps),
      )
      if (!base || !signing) {
        return errorResponse(
          'not_configured',
          'Signing not configured',
          503,
          req,
        )
      }
      const host = base.replace(/\/+$/, '')
      const token = await signing.documenso.signingToken(
        envelope_id,
        recipient_id,
      )
      // No token for her recipient: the envelope moved on (signed or cancelled
      // there). « Synchroniser » settles it; nothing to sign here now.
      if (!token) {
        await report('signing_token_missing', {
          client_consent_request_id: input.request_id,
        })
        return jsonResponse(
          {
            error: { code: 'provider_error', message: 'No signing token' },
            request_id: requestId,
          },
          502,
          req,
        )
      }
      return noStore({
        state: 'ready',
        request_id: requestId,
        token,
        signing_url: `${host}/sign/${encodeURIComponent(token)}`,
        host,
      }, req)
    } catch (error) {
      // The clinic's Documenso is not set up, or its settings cannot be read.
      if (error instanceof SigningFailure) {
        return errorResponse(
          'not_configured',
          'Signing not configured',
          503,
          req,
        )
      }
      if (error instanceof DocumensoError) {
        const refused = error.code === 'not_configured'
        return jsonResponse(
          {
            error: {
              code: refused ? 'not_configured' : 'provider_error',
              message: 'Documenso failed',
            },
            request_id: requestId,
          },
          refused ? 503 : 502,
          req,
        )
      }
      await report('signing_token_failed', {
        client_consent_request_id: input.request_id,
      })
      return errorResponse('internal', 'Countersignature failed', 500, req)
    }
  }
}
