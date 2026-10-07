// SUPABASE_ALLOWED: the auth provider owns the Supabase auth session.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/core/supabase/client'

export type AuthErrorCode = 'invalid_credentials' | 'rate_limited' | 'unknown'

export interface AuthContextValue {
  session: Session | null
  isLoading: boolean
  signInWithPassword: (email: string, password: string) => Promise<AuthErrorCode | null>
  sendMagicLink: (email: string) => Promise<AuthErrorCode | null>
  sendPasswordReset: (email: string) => Promise<AuthErrorCode | null>
  updatePassword: (password: string) => Promise<AuthErrorCode | null>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function toCode(error: { message: string; status?: number } | null): AuthErrorCode | null {
  if (!error) return null
  if (error.status === 429) return 'rate_limited'
  if (/invalid login credentials/i.test(error.message)) return 'invalid_credentials'
  return 'unknown'
}

const absolute = (path: string) => `${window.location.origin}${path}`

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setIsLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      signInWithPassword: async (email, password) =>
        toCode((await supabase.auth.signInWithPassword({ email, password })).error),
      // shouldCreateUser: false — accounts only exist through invitations.
      // An unknown email returns "signups not allowed" (422): treat it as success so the
      // page never reveals whether an account exists.
      sendMagicLink: async (email) => {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: absolute('/accueil') },
        })
        if (error && (error.code === 'otp_disabled' || (error.status === 422 && /signups not allowed/i.test(error.message)))) {
          return null
        }
        return toCode(error)
      },
      sendPasswordReset: async (email) =>
        toCode((await supabase.auth.resetPasswordForEmail(email, { redirectTo: absolute('/reinitialiser-mot-de-passe') })).error),
      updatePassword: async (password) => toCode((await supabase.auth.updateUser({ password })).error),
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, isLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
