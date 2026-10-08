import { supabase } from '@/core/supabase/client'
import type { Json } from '@/core/supabase/database.types'

/**
 * Per-user preferences (`user_preferences`, migration 20261008113715): small UI state that follows
 * the person, not the computer (remembered list filters). Read with a plain select (RLS: own rows
 * while active); written only through `set_user_preference` / `delete_user_preference`, which
 * take the user and the clinic from the session. Never mirrored in localStorage (decision #10:
 * reception computers are shared).
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

/** Saves (inserts or replaces) the signed-in user's value for `key`. */
export async function saveUserPreference(key: string, value: PreferenceValue): Promise<void> {
  const { error } = await supabase.rpc('set_user_preference', { p_key: key, p_value: value })
  if (error) throw error
}

/** Forgets the signed-in user's value for `key` (nothing happens when there is none). */
export async function deleteUserPreference(key: string): Promise<void> {
  const { error } = await supabase.rpc('delete_user_preference', { p_key: key })
  if (error) throw error
}
