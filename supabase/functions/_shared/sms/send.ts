/**
 * One claimed text, sent and settled (batch SM): shared by `sms-send` (a
 * staff reply or test, claimed by `queue_sms_for_service`), `sms-dispatch`
 * (the queue, claimed by `claim_sms_batch_for_service`) and `sms-webhook`
 * (the acknowledgement of a withdrawal, claimed by `record_inbound_sms`).
 *
 * The transport sends; `mark_sms_sent` records the PBX's ids, or
 * `mark_sms_failed` the failure's code. A failure of the transport that is
 * the clinic's to fix (`not_configured`, `module_disabled`) or the PBX's
 * (`provider_*`, `token_*`, `channel_not_found`, `lock_timeout`) is recorded
 * and returned, reported once with ids; anything else is reported `unexpected`
 * and recorded `internal`. Never throws. Reports carry the function, the code
 * and the ids: never the number or the body.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '../report.ts'
import { type SmsTransport, SmsTransportError } from './transport.ts'

/** A claimed row, as the RPCs return it. */
export interface ClaimedText {
  id: string
  to_e164: string
  body: string
  request_id: string
}

export interface SendContext {
  /** The calling function, for reports. */
  fn: string
  client: SupabaseClient
  transport: SmsTransport
  fetch: typeof fetch
  signal?: AbortSignal
}

export type SendOutcome = { ok: true } | { ok: false; code: string }

/** Codes that are the clinic's setup, not an incident: recorded, not reported. */
const SETUP_CODES = new Set(['not_configured', 'module_disabled'])

/** Sends one claimed text and settles its row; see the module comment. */
export async function sendClaimedText(
  ctx: SendContext,
  orgId: string,
  text: ClaimedText,
): Promise<SendOutcome> {
  const ids = { org_id: orgId, sms_message_id: text.id }
  let code: string
  try {
    const sent = await ctx.transport.send(
      orgId,
      { to: text.to_e164, body: text.body, requestId: text.request_id },
      ctx.signal,
    )
    const { error } = await ctx.client.rpc('mark_sms_sent', {
      p_org_id: orgId,
      p_id: text.id,
      p_provider_msg_id: sent.msgId,
      p_provider_session_id: sent.sessionId,
    })
    if (error) {
      await reportError({ fn: ctx.fn, code: 'mark_sms_sent_failed', ids }, ctx.fetch)
      return { ok: false, code: 'internal' }
    }
    return { ok: true }
  } catch (error) {
    if (error instanceof SmsTransportError) {
      code = error.code
      if (!SETUP_CODES.has(code)) {
        await reportError({ fn: ctx.fn, code: `sms_${code}`, ids }, ctx.fetch)
      }
    } else {
      code = 'internal'
      await reportError({ fn: ctx.fn, code: 'unexpected', ids }, ctx.fetch)
    }
  }
  const { error } = await ctx.client.rpc('mark_sms_failed', {
    p_org_id: orgId,
    p_id: text.id,
    p_error_code: code,
  })
  if (error) {
    await reportError({ fn: ctx.fn, code: 'mark_sms_failed_failed', ids }, ctx.fetch)
  }
  return { ok: false, code }
}
