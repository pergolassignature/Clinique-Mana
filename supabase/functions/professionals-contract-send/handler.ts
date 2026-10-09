/**
 * `professionals-contract-send` (Task 4d.2, design §3.8, A5; P4-482): « Préparer
 * et envoyer », « Réessayer l'envoi », « Renvoyer » and « Régénérer » on a
 * professional's form to sign: the service contract, or the image consent
 * (« Consentement au droit à l'image »). This function renders
 * (`_shared/signing.ts`), so it carries pdfmake (ADR 0008).
 *
 * The form comes from a closed list (`FORMS`): each one names its purpose,
 * its permissions, its prepare RPC, the request's view permission and whether
 * it prints Annexe A. Nothing about a form is read from the body but its key.
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `professionals`.
 * 2. Body `{ professional_id, action: 'send' | 'regenerate' | 'resend',
 *    idempotency_key, form? }` (`form`: `service_contract`, the default, or
 *    `image_consent`; the key a uuid the page draws per action and keeps
 *    until it succeeds). Nothing else is read from the body: the values, the
 *    signers, the template version and the title come from the database.
 *    Then the form's permissions → 403 `forbidden` otherwise: the contract
 *    needs `professionals.contracts.send` and `professionals.compensation`
 *    (it prints the professional's pay, P4-436), the image consent
 *    `professionals.manage` (P4-483).
 * 3. One hit on `LIMITS.professionalContractUser` (30 an hour per caller,
 *    both forms); `resend` also takes `LIMITS.professionalContractResend`
 *    (one per file and form every 10 s, P4-478), so a double click emails the
 *    signer once.
 * 4. The form's prepare RPC (`prepare_professional_contract`,
 *    `prepare_professional_image_consent`) with the **service** client, `p_actor` =
 *    the caller `verifyAuth` verified: it re-checks her, then answers the
 *    request key (the open draft's own for `send`: a failed send is retried
 *    as the same request), the published version, the title, the values, the
 *    Annexe A terms and the signers of the snapshot (written once per key,
 *    P4-151), and for `regenerate` the open request to close first. P0001 →
 *    400 with its French message and its HINT as `field` (`template`,
 *    `pricing`, `profession`, `contract`, `consent`, `status`, `regenerate`);
 *    42501 → 403; 22023 → 400. The image consent has no Annexe A.
 * 5. `resend`: Documenso `redistribute` to the next signer of the open request
 *    (the link renewed). 200 `{ request_id }`. No envelope or no signer left
 *    to email → a French refusal (400), never a 200 that sent nothing.
 *    `prepare_professional_contract` refuses, before anything is cancelled or
 *    written, a version without Annexe A's placeholder and a required value
 *    that is empty, and « Régénérer » while another send's claim is fresh.
 * 6. `regenerate` with an open request: its Documenso envelope cancelled
 *    first (a pending one cancelled, a draft deleted, E-8), then
 *    `cancel_signature_request(p_id, p_by)`. A failed Documenso cancel stops
 *    here (502 `provider_error`): never two live contracts.
 * 7. `createSignatureRequest` (the form's purpose, subject `professional`,
 *    the form's view permission: `professionals.compensation` for the
 *    contract (P4-435), `professionals.view` for the consent (P4-483); the
 *    snapshot's values, and for the contract Annexe A's blocks for the block
 *    placeholder `pricing.annexe_a`, P4-433). A signed image consent becomes a
 *    verified document in the database (P4-484). Documenso sends the French
 *    signing email with the version's subject and message (P3-3); the expiry
 *    is « Signature électronique »'s. 200 `{ request_id, existing }`.
 *
 * The send does not follow the caller's connection (`req.signal` is not
 * passed), as `signing-test-document`. Every stored copy follows Phase 3's
 * capture: the source PDF before the send, the signed PDF on completion (the
 * webhook, then the hourly reconcile), so a Documenso id is never the only
 * copy (ADR 0005 « Pas de sauvegarde »).
 *
 * Status codes: 200; 400 `invalid_request` (body, a P0001 refusal, 22023) or
 * `missing_variable` (a value the template requires is empty: `variable` is
 * its path, `label` its French label); 401 / 403 / 503 from `verifyAuth`;
 * 403 `forbidden` (no `professionals.compensation`, 42501); 405; 409
 * `conflict` (« Un envoi est déjà en cours. »); 413; 429; 502
 * `provider_error` (Documenso failed; the same key sends again); 503
 * `not_configured` (no Documenso address or key, the key refused, the
 * limiter down); 500 `internal` (reported with the org, professional and
 * request ids). Nothing logs or answers an address.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
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
  orgSigning,
  type SigningFailure,
} from '../_shared/signing-events.ts'
import { createSignatureRequest } from '../_shared/signing.ts'
import { annexeBlocks, annexeSchema } from './annexe.ts'

const FN = 'professionals-contract-send'
/** The template's block placeholder for Annexe A (the seeded body, P4-433). */
export const ANNEXE_PATH = 'pricing.annexe_a'
export const PURPOSE = 'professionals.service_contract'
/** P4-435: the contract prints the pay. */
export const VIEW_PERMISSION = 'professionals.compensation'

/** The forms this function sends (P4-482): a closed list, never a purpose from the body. */
export const FORMS = {
  service_contract: {
    purpose: PURPOSE,
    prepare: 'prepare_professional_contract',
    /** P4-436: whoever sends the contract reads the pay it prints. */
    permissions: ['professionals.contracts.send', VIEW_PERMISSION],
    viewPermission: VIEW_PERMISSION,
    annexe: true,
  },
  image_consent: {
    purpose: 'professionals.image_consent',
    prepare: 'prepare_professional_image_consent',
    /** P4-483: not a pay document; whoever manages the file's documents. */
    permissions: ['professionals.manage'],
    viewPermission: 'professionals.view',
    annexe: false,
  },
} as const
export type FormKey = keyof typeof FORMS

const bodySchema = z.strictObject({
  // guid, not uuid: seed and fixture ids are not RFC 4122 variants.
  professional_id: z.guid(),
  action: z.enum(['send', 'regenerate', 'resend']),
  idempotency_key: z.guid(),
  form: z.enum(['service_contract', 'image_consent']).default(
    'service_contract',
  ),
})

const signerSchema = z.object({
  role: z.enum(['professional', 'clinic', 'client']),
  name: z.string(),
  email: z.string(),
  order: z.number().int(),
})

const preparedSchema = z.object({
  idempotency_key: z.string(),
  template_version_id: z.string(),
  title: z.string(),
  values: z.record(z.string(), z.unknown()),
  /** The contract's only (the image consent prints no Annexe A). */
  annexe: annexeSchema.optional(),
  signers: z.array(signerSchema).min(1),
  cancel: z.object({
    request_id: z.string(),
    envelope_id: z.string().nullable(),
    status: z.string(),
  }).nullable(),
})

const resendSchema = z.object({
  resend: z.object({
    request_id: z.string(),
    envelope_id: z.string().nullable(),
    recipient_ids: z.array(z.string()),
  }),
})

/** The contract's resend refusals, as `prepare_professional_contract` words them. */
export const NO_ENVELOPE =
  "Ce contrat n'a pas d'envoi Documenso à renvoyer : utilisez « Régénérer »."
export const NO_RECIPIENT =
  "Personne n'attend ce courriel : utilisez « Synchroniser » pour mettre le contrat à jour."

const STATUS = {
  not_configured: 503,
  module_disabled: 403,
  provider_error: 502,
} as const

/** The contract handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { module: 'professionals' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const form = FORMS[input.form]
    if (
      !form.permissions.every((key) => auth.access.permissions.includes(key))
    ) {
      return errorResponse('forbidden', 'Forbidden', 403, req)
    }
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const { org_id: orgId, user_id: actor } = auth.access
    const professionalId = input.professional_id
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError({
        fn: FN,
        code,
        ids: { org_id: orgId, professional_id: professionalId, ...ids },
      }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.professionalContractUser, [orgId, actor]),
      req,
    )
    if (limited) return limited
    if (input.action === 'resend') {
      // One « Renvoyer » per file every 10 s: a double click emails the signer once (P4-478).
      const again = limitResponse(
        await consume(service, LIMITS.professionalContractResend, [
          orgId,
          professionalId,
          input.form,
        ]),
        req,
      )
      if (again) return again
    }

    const prepared = await service.rpc(form.prepare, {
      p_actor: actor,
      p_id: professionalId,
      p_action: input.action,
      p_idempotency_key: input.idempotency_key,
    })
    if (prepared.error) {
      const error = prepared.error as RpcError
      if (!isExpectedRpcError(error)) await report('prepare_failed')
      return professionalsRpcError(error, req)
    }

    const reach = documensoReach(deps)
    const documenso = async () =>
      (await orgSigning(service, orgId, deps.fetch, reach))?.documenso ?? null

    try {
      if (input.action === 'resend') {
        const parsed = resendSchema.safeParse(prepared.data)
        if (!parsed.success) {
          await report('prepare_invalid')
          return errorResponse('internal', 'Contract resend failed', 500, req)
        }
        const { request_id: requestId, envelope_id, recipient_ids } =
          parsed.data.resend
        // The prepare RPCs refuse both (review of 4d); never a 200 that sent nothing.
        if (!envelope_id) {
          return refusalResponse(NO_ENVELOPE, req)
        }
        if (recipient_ids.length === 0) {
          return refusalResponse(NO_RECIPIENT, req)
        }
        const client = await documenso()
        if (!client) {
          return errorResponse(
            'not_configured',
            'Signing not configured',
            503,
            req,
          )
        }
        try {
          await client.redistribute(envelope_id, recipient_ids)
        } catch (error) {
          return providerFailure(error, requestId)
        }
        return jsonResponse({ request_id: requestId }, 200, req)
      }

      const parsed = preparedSchema.safeParse(prepared.data)
      // The contract never goes out without its Annexe A terms.
      if (!parsed.success || (form.annexe && !parsed.data.annexe)) {
        await report('prepare_invalid')
        return errorResponse('internal', 'Contract send failed', 500, req)
      }
      const contract = parsed.data

      if (contract.cancel) {
        const { request_id: requestId, envelope_id } = contract.cancel
        if (envelope_id) {
          const client = await documenso()
          if (!client) {
            return errorResponse(
              'not_configured',
              'Signing not configured',
              503,
              req,
            )
          }
          try {
            // Pending → cancelled; a draft → deleted (E-8, read back after a 400).
            await client.cancel(envelope_id)
          } catch (error) {
            return providerFailure(error, requestId)
          }
        }
        const cancelled = await service.rpc('cancel_signature_request', {
          p_id: requestId,
          p_by: actor,
        })
        if (cancelled.error) {
          const error = cancelled.error as RpcError
          if (error.code === 'P0001' && error.message) {
            return refusalResponse(error.message, req)
          }
          await report('cancel_failed', { signature_request_id: requestId })
          return errorResponse(
            'internal',
            'Contract regenerate failed',
            500,
            req,
          )
        }
      }

      const result = await createSignatureRequest({
        client: service,
        fetch: deps.fetch,
        reach,
        now: deps.now,
      }, {
        orgId,
        moduleKey: 'professionals',
        purpose: form.purpose,
        templateVersionId: contract.template_version_id,
        subject: { type: 'professional', id: professionalId },
        title: contract.title,
        viewPermission: form.viewPermission,
        values: contract.values,
        ...(form.annexe && contract.annexe &&
          { blocks: { [ANNEXE_PATH]: annexeBlocks(contract.annexe) } }),
        signers: contract.signers,
        idempotencyKey: contract.idempotency_key,
        sentBy: actor,
      })
      if (result.ok) {
        return jsonResponse(
          { request_id: result.requestId, existing: result.existing },
          200,
          req,
        )
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
        default:
          return jsonResponse(
            {
              error: {
                code: result.code,
                message: 'The contract could not be sent',
              },
              ...(result.requestId && { request_id: result.requestId }),
            },
            STATUS[result.code],
            req,
          )
      }
    } catch (error) {
      const { code, requestId } = error as Partial<SigningFailure>
      await report(
        typeof code === 'string' ? code : 'contract_send_failed',
        requestId ? { signature_request_id: requestId } : {},
      )
      return errorResponse(
        'internal',
        'The contract could not be sent',
        500,
        req,
      )
    }

    /** A Documenso failure of a resend or a cancel: the key refused, or Documenso failing. */
    function providerFailure(error: unknown, requestId: string): Response {
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
  }
}
