import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { UNEXPECTED_SHAPE } from './sms'

/**
 * Paramètres → Textos (batch SM, SM-10): the clinic's PBX address, the OpenAPI client id, the
 * clinic's SMS number and the two automatic texts (`org_module_settings`, module communications,
 * through `get_sms_settings` / `set_sms_settings`). The client secret and the webhook secret are
 * org secrets (`SecretField`), never here.
 */
export interface SmsSettings {
  baseUrl: string | null
  clientId: string | null
  /** E.164, as stored. */
  did: string | null
  consentText: string
  optOutReply: string
}

const settingsSchema = z
  .object({
    sms_base_url: z.string().nullable(),
    sms_client_id: z.string().nullable(),
    sms_did: z.string().nullable(),
    sms_consent_text: z.string(),
    sms_opt_out_reply: z.string(),
  })
  .transform(
    (r): SmsSettings => ({
      baseUrl: r.sms_base_url,
      clientId: r.sms_client_id,
      did: r.sms_did,
      consentText: r.sms_consent_text,
      optOutReply: r.sms_opt_out_reply,
    }),
  )

const SETTING_KEYS = {
  baseUrl: 'sms_base_url',
  clientId: 'sms_client_id',
  did: 'sms_did',
  consentText: 'sms_consent_text',
  optOutReply: 'sms_opt_out_reply',
} as const satisfies Record<keyof SmsSettings, string>

function parseSettings(data: unknown): SmsSettings {
  const result = settingsSchema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

/** The effective settings (stored values over the defaults; communications.sms). */
export async function fetchSmsSettings(): Promise<SmsSettings> {
  const { data, error } = await supabase.rpc('get_sms_settings')
  if (error) throw error
  return parseSettings(data)
}

/** Saves the given keys only (communications.sms_manage); resolves with the effective settings. A refusal is a French `P0001`. */
export async function saveSmsSettings(patch: Partial<SmsSettings>): Promise<SmsSettings> {
  const p_patch = Object.fromEntries(Object.entries(patch).map(([field, value]) => [SETTING_KEYS[field as keyof SmsSettings], value]))
  const { data, error } = await supabase.rpc('set_sms_settings', { p_patch })
  if (error) throw error
  return parseSettings(data)
}

/** When the PBX last posted an event to the clinic's `sms-webhook` (settings.view), or null. */
export async function fetchLastYeastarEventAt(): Promise<string | null> {
  const { data, error } = await supabase.rpc('last_webhook_event_at', { p_provider: 'yeastar' })
  if (error) throw error
  // The generated type says string; max() over no row is null.
  return (data as string | null) ?? null
}

/** The address the PBX's « Webhook Event Push » entry posts to (`?org=` names whose secret verifies it). */
export function smsWebhookUrl(orgId: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-webhook?org=${encodeURIComponent(orgId)}`
}
