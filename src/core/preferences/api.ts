import { supabase } from '@/core/supabase/client'
import type { Json } from '@/core/supabase/database.types'

/**
 * Per-user preferences (`user_preferences`, migration 20261008133602): small UI state that follows
 * the person, not the computer (remembered list filters). Read with a plain select (RLS: own rows
 * while active); written only through `set_user_preference` / `delete_user_preference`, which
 * take the user and the clinic from the session, and refuse a write made for another user
 * (`p_user_id`, HINT `user_mismatch`). Never mirrored in localStorage (decision #10: reception
 * computers are shared).
 */

/** A preference's value: a JSON object (the table refuses anything else, and more than 16 KB). */
export type PreferenceValue = { [key: string]: Json | undefined }

const isObject = (value: Json | undefined): value is PreferenceValue => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The signed-in user's value for `key`, or null when there is none. */
export async function fetchUserPreference(userId: string, key: string): Promise<PreferenceValue | null> {
  // The user filter is what RLS enforces anyway; it lets the primary key (user_id, key) serve the read.
  const { data, error } = await supabase.from('user_preferences').select('value').eq('user_id', userId).eq('key', key).maybeSingle()
  if (error) throw error
  return data && isObject(data.value) ? data.value : null
}

/**
 * Saves (inserts or replaces) `userId`'s value for `key`. `userId` is who made the change: the
 * database refuses it (42501, HINT `user_mismatch`) when the session is someone else's by the time
 * the request goes out.
 */
export async function saveUserPreference(userId: string, key: string, value: PreferenceValue): Promise<void> {
  const { error } = await supabase.rpc('set_user_preference', { p_user_id: userId, p_key: key, p_value: value })
  if (error) throw error
}

/** Forgets `userId`'s value for `key` (nothing happens when there is none); refused like a save for another user. */
export async function deleteUserPreference(userId: string, key: string): Promise<void> {
  const { error } = await supabase.rpc('delete_user_preference', { p_user_id: userId, p_key: key })
  if (error) throw error
}

// The writers drop what they hold at every auth event (`usePreferenceWriter`).
export { onSessionUserChange } from '@/core/auth/session-events'
