/**
 * « Envoyer la copie signée » (Clients C5b, CC-17): the sealed PDF of a
 * consent emailed to the people who sign for the client today, then recorded
 * on the consent. Called by `clients-consent-send` (action `copy`) after its
 * auth and limit.
 *
 * 1. `prepare_client_consent_copy_for_service` (service role, `p_actor` = the
 *    verified caller): the recipients, the language, the PDF's object; a
 *    French refusal otherwise (P3-40 `module_reserved`, no PDF, no address…).
 * 2. The PDF read from storage (must be a PDF), attached to one email per
 *    recipient (`clients.consent_signed_copy`, or `_en`), as the caller.
 * 3. One sent → `mark_client_consent_copy_sent_for_service` (« Copie envoyée
 *    le … »). A failure to record it is reported; the emails are gone.
 *
 * Nothing logs or reports a name, an address or the file's path: the reports
 * carry the org and the consent ids.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { errorResponse, jsonResponse } from '../_shared/auth.ts'
import { consentRpcError } from '../_shared/client-consents.ts'
import type { Deps } from '../_shared/deps.ts'
import { type SendResult, sendTemplatedEmail } from '../_shared/email/send.ts'
import { isExpectedRpcError } from '../_shared/errors.ts'
import { reportError } from '../_shared/report.ts'
import { sniff } from '../_shared/storage.ts'

const preparedCopySchema = z.object({
  consent_id: z.string(),
  language: z.enum(['fr', 'en']),
  consent_name: z.string().min(1),
  client_first_name: z.string(),
  clinic_name: z.string(),
  signed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  file: z.object({ bucket: z.string().min(1), object_path: z.string().min(1) }),
  recipients: z.array(z.object({
    role: z.enum(['client', 'client_2']),
    first_name: z.string(),
    email: z.string(),
  })).min(1).max(2),
})
export type PreparedCopy = z.infer<typeof preparedCopySchema>

/** The email template of the copy's language. */
export const copyEmailTemplate = (language: 'fr' | 'en') =>
  language === 'en'
    ? 'clients.consent_signed_copy_en'
    : 'clients.consent_signed_copy'

/**
 * The attachment's name: the consent's name with « signé » (« signed »), in
 * the characters the send path accepts (letters, digits, spaces, ' ’ ( ) . _ -);
 * anything else becomes a space. Never a person's name.
 */
export function copyFilename(consentName: string, language: 'fr' | 'en') {
  const suffix = language === 'en' ? ' (signed)' : ' (signé)'
  const name = consentName
    .replace(/[^\p{L}\p{N} '’()._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .slice(0, 80)
    .trim()
  return `${
    name || (language === 'en' ? 'Consent' : 'Consentement')
  }${suffix}.pdf`
}

interface CopyContext {
  fn: string
  deps: Deps
  client: SupabaseClient
  orgId: string
  actor: string
  req: Request
}

/** Prepares, sends and records the copy; see the module comment. */
export async function sendSignedCopy(
  ctx: CopyContext,
  consentId: string,
): Promise<Response> {
  const { fn, deps, client, orgId, actor, req } = ctx
  const ids = { org_id: orgId, client_consent_id: consentId }
  const { data, error } = await client.rpc(
    'prepare_client_consent_copy_for_service',
    { p_org_id: orgId, p_actor: actor, p_consent_id: consentId },
  )
  if (error) {
    if (!isExpectedRpcError(error)) {
      await reportError({ fn, code: 'copy_prepare_failed', ids }, deps.fetch)
    }
    return consentRpcError(error, req)
  }
  const parsed = preparedCopySchema.safeParse(data)
  if (!parsed.success) {
    await reportError({ fn, code: 'copy_prepare_invalid', ids }, deps.fetch)
    return errorResponse('internal', 'Signed copy failed', 500, req)
  }
  const prepared = parsed.data

  let bytes: Uint8Array | null = null
  try {
    const file = await client.storage.from(prepared.file.bucket).download(
      prepared.file.object_path,
    )
    if (!file.error && file.data) {
      bytes = new Uint8Array(await file.data.arrayBuffer())
    }
  } catch {
    bytes = null
  }
  if (!bytes || sniff(bytes) !== 'pdf') {
    await reportError({ fn, code: 'copy_file_unavailable', ids }, deps.fetch)
    return errorResponse('internal', 'Signed copy unavailable', 500, req)
  }

  const filename = copyFilename(prepared.consent_name, prepared.language)
  const outcomes: {
    role: 'client' | 'client_2'
    ok: boolean
    code?: string
  }[] = []
  for (const recipient of prepared.recipients) {
    let result: SendResult
    try {
      result = await sendTemplatedEmail(
        { fn, client, env: deps.env, fetch: deps.fetch },
        {
          orgId,
          templateKey: copyEmailTemplate(prepared.language),
          to: { email: recipient.email, profileId: null },
          subject: { type: 'client_consent', id: prepared.consent_id },
          values: {
            recipient: { first_name: recipient.first_name },
            client: { first_name: prepared.client_first_name },
            consent: {
              name: prepared.consent_name,
              signed_on: prepared.signed_on,
            },
            clinic: { name: prepared.clinic_name },
          },
          actionUrl: null,
          sentBy: actor,
          // An explicit act (its 5 s guard stops a double click).
          explicitResend: true,
          attachments: [{
            filename,
            content: bytes,
            contentType: 'application/pdf',
          }],
        },
      )
    } catch {
      // sendTemplatedEmail reported it.
      outcomes.push({ role: recipient.role, ok: false, code: 'internal' })
      continue
    }
    outcomes.push(
      result.ok
        ? { role: recipient.role, ok: true }
        : { role: recipient.role, ok: false, code: result.code },
    )
  }

  let copySentAt: string | null = null
  if (outcomes.some((o) => o.ok)) {
    const marked = await client.rpc(
      'mark_client_consent_copy_sent_for_service',
      { p_org_id: orgId, p_consent_id: prepared.consent_id, p_actor: actor },
    )
    if (marked.error || typeof marked.data !== 'string') {
      await reportError({ fn, code: 'copy_mark_failed', ids }, deps.fetch)
    } else {
      copySentAt = marked.data
    }
  }
  return jsonResponse(
    {
      consent_id: prepared.consent_id,
      copy_sent_at: copySentAt,
      recipients: outcomes.map((o) => ({
        role: o.role,
        sent: o.ok,
        ...(o.code && { code: o.code }),
      })),
    },
    200,
    req,
  )
}
