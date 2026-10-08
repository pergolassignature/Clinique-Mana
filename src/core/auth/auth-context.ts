import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'weak_password'
  | 'same_password'
  | 'reauthentication_needed'
  /** The reauthentication code is wrong or expired. */
  | 'invalid_code'
  | 'invalid_email'
  | 'rate_limited'
  | 'unknown'

export interface AuthContextValue {
  session: Session | null
  isLoading: boolean
  /** True between a PASSWORD_RECOVERY event and the password update (or sign-out). */
  isRecovery: boolean
  /** True after THIS tab's own signOut(), until the next session: the guard then skips ?redirect=. */
  signedOutHere: boolean
  signInWithPassword: (email: string, password: string) => Promise<AuthErrorCode | null>
  /** `redirectPath` is where the link lands after sign-in (sanitised; defaults to /accueil). */
  sendMagicLink: (email: string, redirectPath?: string | null) => Promise<AuthErrorCode | null>
  sendPasswordReset: (email: string) => Promise<AuthErrorCode | null>
  /**
   * `nonce`: the code from `sendReauthenticationCode()`, needed when GoTrue answers
   * `reauthentication_needed` (session older than 24 h, `secure_password_change`).
   * After a recovery link, a successful change also signs out the other sessions (decision #15).
   */
  updatePassword: (password: string, nonce?: string) => Promise<AuthErrorCode | null>
  /** Emails the signed-in user a code that confirms a password change. */
  sendReauthenticationCode: () => Promise<AuthErrorCode | null>
  /**
   * Asks for an email change: both addresses get a confirmation link (`double_confirm_changes`).
   * Neutral: an address already used by another account, or the per-user email throttle, returns
   * null like a success (decision #38).
   */
  updateEmail: (email: string) => Promise<AuthErrorCode | null>
  /** Signs out this device only (decision #13); always forgets the local session. */
  signOut: () => Promise<void>
  /**
   * Ends every session of the account, this one included. On failure the local session is kept
   * and the code returned, so the user knows the other devices may still be signed in.
   */
  signOutEverywhere: () => Promise<AuthErrorCode | null>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
