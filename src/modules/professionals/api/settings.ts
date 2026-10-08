import { supabase } from '@/core/supabase/client'
import { parseRpc, settingsPayload, type ProfessionalsSettings } from './parse'

/**
 * The module's settings (`org_module_settings`, module `professionals`). 4b and 4c add keys: each
 * one gets a field in `settingsPayload` and a column here.
 */
const SETTING_KEYS = {
  collectSin: 'collect_sin',
  invitationExpiryDays: 'invitation_expiry_days',
  invitationReminderAfterDays: 'invitation_reminder_after_days',
} as const satisfies Record<keyof ProfessionalsSettings, string>

/** The effective settings (stored values over the defaults). Open to any professionals permission. */
export async function fetchProfessionalsSettings(): Promise<ProfessionalsSettings> {
  const { data, error } = await supabase.rpc('get_professionals_settings')
  if (error) throw error
  return parseRpc(settingsPayload, data)
}

/**
 * Saves the given keys only (`professionals.settings`; `collectSin` also needs
 * `professionals.private`) and resolves with the effective settings. A reminder that would leave
 * after the link expires is a French `P0001`, HINT `invitation_reminder_after_days` (P4-308).
 */
export async function saveProfessionalsSettings(patch: Partial<ProfessionalsSettings>): Promise<ProfessionalsSettings> {
  const p_patch = Object.fromEntries(Object.entries(patch).map(([field, value]) => [SETTING_KEYS[field as keyof ProfessionalsSettings], value]))
  const { data, error } = await supabase.rpc('set_professionals_settings', { p_patch })
  if (error) throw error
  return parseRpc(settingsPayload, data)
}
