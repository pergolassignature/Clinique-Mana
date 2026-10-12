/**
 * `clients-consent-send` (Clients C5a): staff send a consent request to the
 * people who must sign it, or send an open one again. A user function
 * (CLAUDE.md §7); the actor model (ADR 0007): the links' tokens are made and
 * hashed here and travel only in the emails, never to the caller.
 *
 * 1. CORS; `POST` only; body `{ action: 'send', client_id, consent_key,
 *    context_type?, context_id?, due_at? }` or `{ action: 'resend',
 *    request_id }`.
 * 2. `verifyAuth` with the module `clients` and `clients.manage`.
 * 3. One hit on `LIMITS.clientConsentSendUser` (60 an hour per caller).
 * 4. `prepare_client_consent_request_for_service` (service role, `p_actor` =
 *    the verified caller): the client, the published text in her language,
 *    who signs (R-48), one link per signer. A refusal (P0001: no published
 *    text, no authorised parent, no address…) is a 400 `refusal` with its
 *    French message and HINT as `field`; 42501 → 403.
 * 5. One email per signer (`clients.consent_request`, or `_en`), each with her
 *    own link `/consentement#t=…`.
 * 6. 200 `{ request_id, resent, signers: [{ role, sent, code? }] }`: an email
 *    that failed is listed (« Renvoyer » sends new links); the request stands.
 *
 * Nothing logs or reports a name, an address or a token.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import {
  consentRpcError,
  emailConsentSigners,
  prepareConsentRequest,
} from '../_shared/client-consents.ts'
import type { Deps } from '../_shared/deps.ts'
import { isExpectedRpcError } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'clients-consent-send'

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('send'),
    // guid, not uuid: seed and fixture ids are not RFC 4122 variants.
    client_id: z.guid(),
    consent_key: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
    context_type: z.enum(['appointment', 'demande', 'waitlist_entry', 'record'])
      .optional(),
    context_id: z.guid().optional(),
    due_at: z.iso.datetime({ offset: true }).optional(),
  }),
  z.strictObject({
    action: z.literal('resend'),
    request_id: z.guid(),
  }),
])

/** The handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    if (
      input.action === 'send' &&
      (input.context_type === undefined) !== (input.context_id === undefined)
    ) {
      return errorResponse('invalid_request', 'Invalid request', 400, req)
    }
    const auth = await verifyAuth(
      req,
      { module: 'clients', permission: 'clients.manage' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const client = deps.serviceClient()
    if (client instanceof Response) return client
    const { org_id: orgId, user_id: actor } = auth.access

    const limited = limitResponse(
      await consume(client, LIMITS.clientConsentSendUser, [orgId, actor]),
      req,
    )
    if (limited) return limited

    const result = await prepareConsentRequest(
      client,
      input.action === 'send'
        ? {
          orgId,
          actor,
          clientId: input.client_id,
          consentKey: input.consent_key,
          contextType: input.context_type ?? null,
          contextId: input.context_id ?? null,
          dueAt: input.due_at ?? null,
        }
        : { orgId, actor, requestId: input.request_id },
    )
    if (!result.ok) {
      if (!result.error) {
        await reportError(
          { fn: FN, code: 'prepare_invalid', ids: { org_id: orgId } },
          deps.fetch,
        )
        return errorResponse('internal', 'Consent request failed', 500, req)
      }
      if (!isExpectedRpcError(result.error)) {
        await reportError(
          { fn: FN, code: 'prepare_failed', ids: { org_id: orgId } },
          deps.fetch,
        )
      }
      return consentRpcError(result.error, req)
    }

    const outcomes = await emailConsentSigners(
      { fn: FN, client, env: deps.env, fetch: deps.fetch },
      orgId,
      result.prepared,
      result.tokens,
      actor,
    )
    return jsonResponse(
      {
        request_id: result.prepared.request_id,
        resent: result.prepared.resent,
        signers: outcomes.map((o) => ({
          role: o.role,
          sent: o.ok,
          ...(o.code && { code: o.code }),
        })),
      },
      200,
      req,
    )
  }
}
