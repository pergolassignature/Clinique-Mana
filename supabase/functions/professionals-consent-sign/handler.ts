/**
 * `professionals-consent-sign` (P4-487, P4-488; decided with Jonathan
 * 2026-10-09): the professional signs her own « Consentement au droit à
 * l'image » in the app — the questionnaire's « Consentement » step and
 * « Mes documents » — through Documenso, without an email. This function
 * renders (`_shared/signing.ts`), so it carries pdfmake (ADR 0008).
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `professionals` and
 *    `professionals.self`.
 * 2. Body `{ action: 'start' | 'sync', idempotency_key?, return_to?,
 *    return_step? }`: `start` needs the key (a uuid the page draws and keeps
 *    until it succeeds); `return_to` (`questionnaire`, the default, or
 *    `documents`) and `return_step` (a step slug) only build the redirect
 *    after signing, on the caller's own app origin when `ALLOWED_ORIGINS`
 *    names it, else `APP_URL` (`returnBase`). Nothing else is read from the body: the file, the values,
 *    the signer and the version come from the database.
 * 3. `start`: one hit on `LIMITS.professionalConsentSignUser` (20 an hour per
 *    caller); `sync`: `LIMITS.signingSyncUser` (60 an hour).
 * 4. `prepare_my_image_consent` with the **service** client, `p_actor` = the
 *    caller `verifyAuth` verified: her own file only (P0001 refusals with a
 *    HINT: `status`, `signed`, `template`, `values`, `consent`; 42501 → 403).
 * 5. `start`:
 *    - her open request (sent or viewed) is **resumed**: its signing token
 *      read again from Documenso (`signingToken`), never a second request;
 *    - otherwise `createSignatureRequest` (purpose
 *      `professionals.image_consent`, view permission `professionals.view`,
 *      `manual`: Documenso's `distributionMethod: 'NONE'`, no email, and the
 *      redirect back to the app once signed). A request this key already sent
 *      (a double click) is resumed the same way.
 *    200 `{ request_id, token, signing_url, host }`: the token and the URL are
 *    **credentials**, returned once, never stored, logged, reported nor
 *    cached (`Cache-Control: no-store`); the page keeps them in component
 *    state for `EmbedSignDocument` (`host`, `token`) or the redirect fallback
 *    (`signing_url`).
 * 6. `sync` (after `onDocumentCompleted`, or back from the signing page):
 *    `syncRequest` on her latest consent request, as « Synchroniser » does
 *    (drafts never settled), the attempt recorded; 200 `{ outcome }`
 *    (`none` without a request). The webhook still completes it.
 *
 * `host` is the clinic's Documenso address (`signing_settings.base_url`);
 * locally only (`APP_URL` local), `DOCUMENSO_PUBLIC_URL` replaces it, since
 * the functions reach the fake as `host.docker.internal` and the browser as
 * `127.0.0.1`.
 *
 * Status codes: 200; 400 `invalid_request` (body, a P0001 refusal) or
 * `missing_variable`; 401 / 403 / 503 from `verifyAuth`; 403 (42501); 405;
 * 409 `conflict` (a send under way); 413; 429; 502 `provider_error`
 * (Documenso failed); 503 `not_configured`; 500 `internal` (reported with the
 * org and request ids only).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  isLocalAppUrl,
  jsonResponse,
  parseOrigins,
  refusalResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { DocumensoError } from '../_shared/documenso.ts'
import { readJson } from '../_shared/http.ts'
import {
  isExpectedRpcError,
  professionalsRpcError,
  type RpcError,
} from '../_shared/professionals.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import {
  documensoReach,
  failureCode,
  orgSigning,
  recordAttempt,
  signingCredentials,
  type SigningFailure,
  syncRequest,
  trackOwnReads,
} from '../_shared/signing-events.ts'
import { createSignatureRequest } from '../_shared/signing.ts'

const FN = 'professionals-consent-sign'
export const PURPOSE = 'professionals.image_consent'
/** P4-484: the consent prints no pay; every reader of the file reads it. */
export const VIEW_PERMISSION = 'professionals.view'

const bodySchema = z.strictObject({
  action: z.enum(['start', 'sync']),
  // guid, not uuid: seed and fixture ids are not RFC 4122 variants.
  idempotency_key: z.guid().optional(),
  return_to: z.enum(['questionnaire', 'documents']).default('questionnaire'),
  return_step: z.string().regex(/^[a-z-]{1,40}$/).default('consentement'),
})

const signerSchema = z.object({
  role: z.enum(['professional', 'clinic', 'client']),
  name: z.string(),
  email: z.string(),
  order: z.number().int(),
})

const preparedSchema = z.object({
  professional_id: z.string(),
  idempotency_key: z.string(),
  template_version_id: z.string(),
  title: z.string(),
  values: z.record(z.string(), z.unknown()),
  signers: z.array(signerSchema).min(1),
})

const resumeSchema = z.object({
  resume: z.object({
    request_id: z.string(),
    envelope_id: z.string(),
    recipient_id: z.string(),
  }),
})

const syncSchema = z.object({
  sync: z.object({
    request_id: z.string(),
    status: z.string(),
    envelope_id: z.string().nullable(),
  }).nullable(),
})

/** Where Documenso sends her back once signed (an app path, never from the body). */
export function redirectUrl(
  appUrl: string,
  returnTo: 'questionnaire' | 'documents',
  step: string,
): string {
  const base = appUrl.replace(/\/+$/, '')
  return returnTo === 'documents'
    ? `${base}/mes-documents?consentement=signe`
    : `${base}/mon-profil/questionnaire?etape=${step}&consentement=signe`
}

/**
 * The app origin to come back to: the caller's `Origin` when `ALLOWED_ORIGINS`
 * lists it (the page that asked, e.g. a second local dev server), else
 * `APP_URL`. Never an origin the allow-list does not name.
 */
export function returnBase(
  req: Request,
  env: (key: string) => string | undefined,
): string {
  const origin = req.headers.get('Origin')
  const allowed = parseOrigins(env('ALLOWED_ORIGINS')) ?? []
  if (origin && allowed.includes(origin)) return origin
  return env('APP_URL') ?? ''
}

/** The answer that carries a credential: never cached. */
function linkResponse(body: unknown, req: Request): Response {
  const res = jsonResponse(body, 200, req)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** The consent handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { module: 'professionals', permission: 'professionals.self' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    if (input.action === 'start' && !input.idempotency_key) {
      return errorResponse('invalid_request', 'Invalid request', 400, req)
    }
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const { org_id: orgId, user_id: actor } = auth.access
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError({ fn: FN, code, ids: { org_id: orgId, ...ids } }, deps.fetch)

    const limited = limitResponse(
      await consume(
        service,
        input.action === 'start'
          ? LIMITS.professionalConsentSignUser
          : LIMITS.signingSyncUser,
        [orgId, actor],
      ),
      req,
    )
    if (limited) return limited

    const prepare = () =>
      service.rpc('prepare_my_image_consent', {
        p_actor: actor,
        p_action: input.action,
        p_idempotency_key: input.idempotency_key ?? null,
      })
    const prepared = await prepare()
    if (prepared.error) {
      const error = prepared.error as RpcError
      if (!isExpectedRpcError(error)) await report('prepare_failed')
      return professionalsRpcError(error, req)
    }

    const reach = documensoReach(deps)
    const providerFailure = (error: unknown, requestId: string): Response => {
      if (!(error instanceof DocumensoError)) throw error
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

    try {
      if (input.action === 'sync') {
        const parsed = syncSchema.safeParse(prepared.data)
        if (!parsed.success) {
          await report('prepare_invalid')
          return errorResponse('internal', 'Consent sync failed', 500, req)
        }
        const row = parsed.data.sync
        if (!row) return jsonResponse({ outcome: 'none' }, 200, req)
        const signing = await orgSigning(service, orgId, deps.fetch, reach)
        if (!signing) {
          return errorResponse(
            'not_configured',
            'Signing not configured',
            503,
            req,
          )
        }
        const tracked = trackOwnReads(signing, row.request_id)
        const record = (attempt: Parameters<typeof recordAttempt>[3]) =>
          row.status === 'draft' ? Promise.resolve() : recordAttempt(
            service,
            orgId,
            row.request_id,
            attempt,
            [],
            deps.fetch,
          )
        try {
          const outcome = await syncRequest(
            {
              client: service,
              orgId,
              signing: tracked.signing,
              now: deps.now,
              fn: FN,
              fetch: deps.fetch,
            },
            {
              id: row.request_id,
              status: row.status,
              envelope_id: row.envelope_id,
            },
            { settleDrafts: false },
          )
          await record({ read: tracked.seen() })
          return jsonResponse({ outcome }, 200, req)
        } catch (error) {
          await record({ code: failureCode(error) })
          if (error instanceof DocumensoError) {
            return providerFailure(error, row.request_id)
          }
          throw error
        }
      }

      // `start`: the open request resumed, else a new one sent without an email.
      const credentials = await signingCredentials(service, orgId)
      const appUrl = returnBase(req, deps.env)
      const localUrl = deps.env('DOCUMENSO_PUBLIC_URL')
      const base = isLocalAppUrl(appUrl) && localUrl
        ? localUrl
        : credentials.base_url
      if (!base || !appUrl) {
        return errorResponse(
          'not_configured',
          'Signing not configured',
          503,
          req,
        )
      }
      const host = base.replace(/\/+$/, '')
      const link = (requestId: string, token: string) =>
        linkResponse({
          request_id: requestId,
          token,
          signing_url: `${host}/sign/${encodeURIComponent(token)}`,
          host,
        }, req)

      const resume = async (data: unknown): Promise<Response | null> => {
        const parsed = resumeSchema.safeParse(data)
        if (!parsed.success) return null
        const { request_id, envelope_id, recipient_id } = parsed.data.resume
        const signing = await orgSigning(service, orgId, deps.fetch, reach)
        if (!signing) {
          return errorResponse(
            'not_configured',
            'Signing not configured',
            503,
            req,
          )
        }
        let token: string | null
        try {
          token = await signing.documenso.signingToken(
            envelope_id,
            recipient_id,
          )
        } catch (error) {
          return providerFailure(error, request_id)
        }
        if (!token) {
          await report('signing_token_missing', {
            signature_request_id: request_id,
          })
          return errorResponse('provider_error', 'No signing link', 502, req)
        }
        return link(request_id, token)
      }

      const resumed = await resume(prepared.data)
      if (resumed) return resumed

      const parsed = preparedSchema.safeParse(prepared.data)
      if (!parsed.success) {
        await report('prepare_invalid')
        return errorResponse('internal', 'Consent start failed', 500, req)
      }
      const consent = parsed.data
      const result = await createSignatureRequest({
        client: service,
        fetch: deps.fetch,
        reach,
        now: deps.now,
      }, {
        orgId,
        moduleKey: 'professionals',
        purpose: PURPOSE,
        templateVersionId: consent.template_version_id,
        subject: { type: 'professional', id: consent.professional_id },
        title: consent.title,
        viewPermission: VIEW_PERMISSION,
        values: consent.values,
        signers: consent.signers,
        idempotencyKey: consent.idempotency_key,
        sentBy: actor,
        manual: {
          redirectUrl: redirectUrl(appUrl, input.return_to, input.return_step),
        },
      })
      if (result.ok) {
        const token = result.links?.find((l) => l.role === 'professional')
          ?.token
        if (token) return link(result.requestId, token)
        // Sent by an earlier call with this key (a double click): resumed.
        const again = await prepare()
        const resumedAgain = again.error ? null : await resume(again.data)
        if (resumedAgain) return resumedAgain
        await report('signing_token_missing', {
          signature_request_id: result.requestId,
        })
        return errorResponse('provider_error', 'No signing link', 502, req)
      }
      switch (result.code) {
        case 'invalid_request':
          return refusalResponse(result.message, req)
        case 'send_in_progress':
          return errorResponse('conflict', result.message, 409, req)
        case 'missing_variable':
          return jsonResponse(
            {
              error: {
                code: 'missing_variable',
                message: 'A template value is missing',
                ...(result.variable &&
                  {
                    variable: result.variable.path,
                    label: result.variable.label,
                  }),
              },
            },
            400,
            req,
          )
        case 'module_disabled':
          return errorResponse('module_disabled', 'Module disabled', 403, req)
        case 'not_configured':
          return errorResponse(
            'not_configured',
            'Signing not configured',
            503,
            req,
          )
        default:
          return jsonResponse(
            {
              error: { code: 'provider_error', message: 'Documenso failed' },
              ...(result.requestId && { request_id: result.requestId }),
            },
            502,
            req,
          )
      }
    } catch (error) {
      const { code, requestId } = error as Partial<SigningFailure>
      await report(
        typeof code === 'string' ? code : 'consent_sign_failed',
        requestId ? { signature_request_id: requestId } : {},
      )
      return errorResponse(
        'internal',
        'The consent could not be prepared',
        500,
        req,
      )
    }
  }
}
