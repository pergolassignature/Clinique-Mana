import type { User } from '@supabase/supabase-js'
import { supabase } from '@/core/supabase/client'

/**
 * Renames the caller's own profile (column grant on `display_name` + the `profiles_update_self`
 * policy). The email is not written here: it follows `auth.users` through a trigger.
 *
 * RLS refuses silently, by updating zero rows (a disabled profile, another user's id): that case
 * throws a 42501-shaped error, which `moduleErrorMessage` turns into the permission text.
 */
export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName.trim() })
    .eq('user_id', userId)
    .select('user_id')
  if (error) throw error
  if (data.length === 0) throw Object.assign(new Error('no row updated'), { code: '42501' })
}

/**
 * The signed-in user as GoTrue has it now. The stored session keeps the user as of sign-in or the
 * last token refresh (up to an hour): an email change confirmed on another device shows here first.
 */
export async function fetchAuthUser(): Promise<User> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data.user
}
