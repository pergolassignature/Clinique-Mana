/**
 * `clients-consent-sign` (Clients C5a): the public consent page
 * (`/consentement#t=…`). A public-token function (CLAUDE.md §7): no user; the
 * link's token is the credential, hashed here, never stored, logged or
 * answered. This function renders (`_shared/signing.ts`), so it carries
 * pdfmake (ADR 0008).
 *
 * 1. CORS; `POST` only; body `{ action: 'open' | 'start', token,
 *    first_name, birth_year?, answers?, idempotency_key? }` (`start` needs
 *    the key: a value the page draws once and keeps).
 * 2. A malformed token → 410 `link_invalid`, before any read.
 * 3. One hit on `LIMITS.clientConsentSignIp` per IP, then one on
 *    `LIMITS.clientConsentLink` per link (the identity check cannot be
 *    brute-forced), before any lookup.
 * 4. `open`: `open_client_consent_for_service` → `ready` with what the page
 *    shows (the consent's name, the clinic, the client's and the signer's
 *    first names, the clauses, the answers when given); `invalid` → 410
 *    `link_invalid`; `identity_mismatch` → 400 refusal.
 * 5. `start`: `start_client_consent_signing_for_service` records the answers
 *    (the first signer's; `agree` clauses must be « Oui ») and either resumes
 *    the envelope already out (the signer's own signing token, read again from
 *    Documenso), or creates the signature request for every signer
 *    (`createSignatureRequest`, purpose `clients.consent`, view
 *    `clients.view`, `manual`: no Documenso email, back to
 *    `/consentement?signe=1`), the answers printed as a table
 *    (`{{consent.clauses}}`). 200 `{ request_id, token, signing_url, host }`
 *    with `no-store`: the signing token is a credential, kept by the page in
 *    component state for `EmbedSignDocument`.
 *
 * The webhook completes the request; core stores the sealed PDF and the
 * Clients trigger records the consent in force.
 *
 * Status codes: 200; 400 `invalid_request` (body; a refusal: identity,
 * answers, a signer without an address) or `missing_variable`; 405; 409
 * `conflict` (a send under way); 410 `link_invalid`; 413; 429; 502
 * `provider_error`; 503 `not_configured` or `module_disabled` (signing);
 * 500 `internal` (reported with ids only).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  isLocalAppUrl,
  jsonResponse,
  parseOrigins,
  refusalResponse,
} from '../_shared/auth.ts'
import {
  type Clause,
  clauseBlocks,
  consentRpcError,
} from '../_shared/client-consents.ts'
import type { Deps } from '../_shared/deps.ts'
import { DocumensoError } from '../_shared/documenso.ts'
import { isExpectedRpcError } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import {
  hashToken,
  isWellFormedToken,
  linkGoneResponse,
} from '../_shared/links.ts'
import {
  clientIp,
  consume,
  limitResponse,
  LIMITS,
} from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import {
  documensoReach,
  orgSigning,
  signingCredentials,
  type SigningFailure,
} from '../_shared/signing-events.ts'
import { createSignatureRequest } from '../_shared/signing.ts'

const FN = 'clients-consent-sign'
export const PURPOSE = 'clients.consent'
export const VIEW_PERMISSION = 'clients.view'
export const IDENTITY_MISMATCH =
  'Le prénom ou l’année de naissance ne correspond pas au dossier de la clinique. Vérifiez-les, puis réessayez.'

const bodySchema = z.strictObject({
  action: z.enum(['open', 'start']),
  token: z.string().max(100),
  first_name: z.string().min(1).max(100),
  birth_year: z.number().int().min(1900).max(2100).nullable().optional(),
  answers: z.record(
    z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    z.enum(['yes', 'no']),
  )
    .optional(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
})

const clauseSchema = z.object({
  key: z.string(),
  kind: z.enum(['agree', 'yes_no']),
  text_fr: z.string(),
  text_en: z.string(),
})

const openSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('invalid') }),
  z.object({ state: z.literal('identity_mismatch'), org_id: z.string() }),
  z.object({
    state: z.literal('ready'),
    org_id: z.string(),
    request_id: z.string(),
    role: z.enum(['client', 'client_2']),
    language: z.enum(['fr', 'en']),
    clinic_name: z.string(),
    consent_name: z.string(),
    client_first_name: z.string(),
    signer_first_name: z.string(),
    clauses: z.array(clauseSchema),
    answers: z.record(z.string(), z.enum(['yes', 'no'])).nullable(),
    can_answer: z.boolean(),
    signing: z.string().nullable(),
  }),
])

const signerSchema = z.object({
  role: z.enum(['client', 'client_2']),
  name: z.string(),
  email: z.string(),
  order: z.number().int(),
})

const startSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('invalid') }),
  z.object({ state: z.literal('identity_mismatch'), org_id: z.string() }),
  z.object({
    state: z.literal('resume'),
    org_id: z.string(),
    request_id: z.string(),
    envelope_id: z.string(),
    recipient_id: z.string(),
  }),
  z.object({
    state: z.literal('prepared'),
    org_id: z.string(),
    consent_request_id: z.string(),
    role: z.enum(['client', 'client_2']),
    template_version_id: z.string(),
    title: z.string(),
    values: z.record(z.string(), z.unknown()),
    signers: z.array(signerSchema).min(1).max(2),
    clauses: z.array(clauseSchema),
    answers: z.record(z.string(), z.enum(['yes', 'no'])),
    language: z.enum(['fr', 'en']),
    sent_by: z.string().nullable(),
    idempotency_key: z.string(),
  }),
])

/**
 * The app origin to come back to after signing: the caller's `Origin` when
 * `ALLOWED_ORIGINS` lists it, else `APP_URL`.
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
function noStore(body: unknown, req: Request): Response {
  const res = jsonResponse(body, 200, req)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

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
    if (!isWellFormedToken(input.token)) {
      return linkGoneResponse('link_invalid', req)
    }
    if (input.action === 'start' && !input.idempotency_key) {
      return errorResponse('invalid_request', 'Invalid request', 400, req)
    }
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const byIp = limitResponse(
      await consume(service, LIMITS.clientConsentSignIp, [clientIp(req)]),
      req,
    )
    if (byIp) return byIp
    const tokenHash = await hashToken(input.token)
    const byLink = limitResponse(
      await consume(service, LIMITS.clientConsentLink, [tokenHash]),
      req,
    )
    if (byLink) return byLink

    let orgId: string | null = null
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError(
        { fn: FN, code, ids: { ...(orgId && { org_id: orgId }), ...ids } },
        deps.fetch,
      )

    if (input.action === 'open') {
      const { data, error } = await service.rpc(
        'open_client_consent_for_service',
        {
          p_token_hash: tokenHash,
          p_first_name: input.first_name,
          p_birth_year: input.birth_year ?? null,
        },
      )
      if (error) {
        if (!isExpectedRpcError(error)) await report('open_failed')
        return consentRpcError(error, req)
      }
      const opened = openSchema.safeParse(data)
      if (!opened.success) {
        await report('open_invalid')
        return errorResponse('internal', 'Consent open failed', 500, req)
      }
      if (opened.data.state === 'invalid') {
        return linkGoneResponse('link_invalid', req)
      }
      if (opened.data.state === 'identity_mismatch') {
        return refusalResponse(IDENTITY_MISMATCH, req)
      }
      const { org_id: _org, ...page } = opened.data
      return noStore(page, req)
    }

    const { data, error } = await service.rpc(
      'start_client_consent_signing_for_service',
      {
        p_token_hash: tokenHash,
        p_first_name: input.first_name,
        p_birth_year: input.birth_year ?? null,
        p_answers: input.answers ?? null,
        p_idempotency_key: input.idempotency_key,
      },
    )
    if (error) {
      if (!isExpectedRpcError(error)) await report('start_failed')
      return consentRpcError(error, req)
    }
    const started = startSchema.safeParse(data)
    if (!started.success) {
      await report('start_invalid')
      return errorResponse('internal', 'Consent start failed', 500, req)
    }
    const step = started.data
    if (step.state === 'invalid') return linkGoneResponse('link_invalid', req)
    if (step.state === 'identity_mismatch') {
      return refusalResponse(IDENTITY_MISMATCH, req)
    }
    orgId = step.org_id

    try {
      const credentials = await signingCredentials(service, step.org_id)
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
        noStore({
          request_id: requestId,
          token,
          signing_url: `${host}/sign/${encodeURIComponent(token)}`,
          host,
        }, req)
      const reach = documensoReach(deps)

      if (step.state === 'resume') {
        const signing = await orgSigning(
          service,
          step.org_id,
          deps.fetch,
          reach,
        )
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
            step.envelope_id,
            step.recipient_id,
          )
        } catch (e) {
          if (!(e instanceof DocumensoError)) throw e
          return errorResponse(
            e.code === 'not_configured' ? 'not_configured' : 'provider_error',
            'Documenso failed',
            e.code === 'not_configured' ? 503 : 502,
            req,
          )
        }
        if (!token) {
          await report('signing_token_missing', {
            signature_request_id: step.request_id,
          })
          return errorResponse('provider_error', 'No signing link', 502, req)
        }
        return link(step.request_id, token)
      }

      const result = await createSignatureRequest({
        client: service,
        fetch: deps.fetch,
        reach,
        now: deps.now,
      }, {
        orgId: step.org_id,
        moduleKey: 'clients',
        purpose: PURPOSE,
        templateVersionId: step.template_version_id,
        subject: {
          type: 'client_consent_request',
          id: step.consent_request_id,
        },
        title: step.title,
        viewPermission: VIEW_PERMISSION,
        values: step.values,
        blocks: {
          'consent.clauses': clauseBlocks(
            step.clauses as Clause[],
            step.answers,
            step.language,
          ),
        },
        signers: step.signers,
        idempotencyKey: step.idempotency_key,
        sentBy: step.sent_by,
        manual: {
          redirectUrl: `${appUrl.replace(/\/+$/, '')}/consentement?signe=1`,
        },
      })
      if (result.ok) {
        const token = result.links?.find((l) => l.role === step.role)?.token
        if (token) return link(result.requestId, token)
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
          await report('missing_variable')
          return errorResponse(
            'missing_variable',
            'A template value is missing',
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
          return errorResponse('provider_error', 'Documenso failed', 502, req)
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
