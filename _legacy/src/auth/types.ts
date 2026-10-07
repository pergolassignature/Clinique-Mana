import type { User, Session } from '@supabase/supabase-js'

export type UserRole = 'admin' | 'staff' | 'provider'

export interface Profile {
  id: string
  user_id: string
  role: UserRole
  display_name: string
  email: string
  status: 'active' | 'disabled'
  created_at: string
  updated_at: string
}

export interface AuthState {
  user: User | null
  session: Session | null
  profile: Profile | null
  isLoading: boolean
  error: AuthError | null
}

export type AuthError =
  | 'invalid_credentials'
  | 'profile_not_found'
  | 'profile_disabled'
  | 'unknown'
