import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'weak_password'
  | 'same_password'
  | 'reauthentication_needed'
  | 'rate_limited'
  | 'unknown'

export interface AuthContextValue {
  session: Session | null
  isLoading: boolean
  /** True between a PASSWORD_RECOVERY event and the password update (or sign-out). */
  isRecovery: boolean
  signInWithPassword: (email: string, password: string) => Promise<AuthErrorCode | null>
  /** `redirectPath` is where the link lands after sign-in (sanitised; defaults to /accueil). */
  sendMagicLink: (email: string, redirectPath?: string | null) => Promise<AuthErrorCode | null>
  sendPasswordReset: (email: string) => Promise<AuthErrorCode | null>
  updatePassword: (password: string) => Promise<AuthErrorCode | null>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
