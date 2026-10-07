import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local')
}

/** Where auth-js stores the session (localStorage key, also its cross-tab BroadcastChannel name). */
export const AUTH_STORAGE_KEY = 'clinique-mana-auth'

export const supabase = createClient<Database>(url, anonKey, { auth: { storageKey: AUTH_STORAGE_KEY } })
