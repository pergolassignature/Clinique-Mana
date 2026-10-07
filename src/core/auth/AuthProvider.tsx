// SUPABASE_ALLOWED: the auth provider owns the Supabase auth session.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AuthError, Session } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, supabase } from '@/core/supabase/client'
import { AuthContext, type AuthContextValue, type AuthErrorCode } from './auth-context'
import { safeRedirect } from './redirect'

/** Maps a GoTrue error to a UI code, by error code (the message is only a fallback for old servers). */
function toCode(error: AuthError | null): AuthErrorCode | null {
  if (!error) return null
  switch (error.code) {
    case 'invalid_credentials':
      return 'invalid_credentials'
    case 'weak_password':
      return 'weak_password'
    case 'same_password':
      return 'same_password'
    case 'reauthentication_needed':
      return 'reauthentication_needed'
    case 'over_request_rate_limit':
      return 'rate_limited'
  }
  if (error.status === 429) return 'rate_limited'
  if (/invalid login credentials/i.test(error.message)) return 'invalid_credentials'
  return 'unknown'
}

/**
 * For "send me an email" calls: errors that only happen for existing accounts are reported as
 * success, so the page never reveals whether an account exists. GoTrue applies the per-email
 * throttle (over_email_send_rate_limit) to existing accounts only.
 */
function toNeutralCode(error: AuthError | null): AuthErrorCode | null {
  if (error?.code === 'over_email_send_rate_limit') return null
  return toCode(error)
}

const absolute = (path: string) => `${window.location.origin}${path}`

/**
 * Forgets this browser's session without any network call: with no stored token, auth-js skips
 * /logout, clears its keys and emits SIGNED_OUT (other tabs get it through its BroadcastChannel).
 */
async function forgetLocalSession(): Promise<void> {
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // Storage blocked: the local sign-out below still clears what auth-js can reach.
  }
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // The stored token is already gone; nothing more can be done offline.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRecovery, setIsRecovery] = useState(false)
  const sessionRef = useRef<Session | null>(null)

  useEffect(() => {
    // auth-js always emits INITIAL_SESSION on subscribe (with null on error), so no getSession() call.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
      else if (event === 'USER_UPDATED' || event === 'SIGNED_OUT') setIsRecovery(false)

      // Skip no-op updates (e.g. focus-triggered refresh events re-sending the same session) so
      // consumers don't re-render. USER_UPDATED always passes: the token stays but the user changed.
      const current = sessionRef.current
      const unchanged = current?.access_token === next?.access_token && current?.user.id === next?.user.id
      if (!unchanged || event === 'USER_UPDATED') {
        sessionRef.current = next
        setSession(next)
      }
      // Any event settles loading, so the app never stays on the loading screen.
      setIsLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      isRecovery,
      signInWithPassword: async (email, password) =>
        toCode((await supabase.auth.signInWithPassword({ email, password })).error),
      // shouldCreateUser: false — accounts only exist through invitations.
      // An unknown email returns "signups not allowed" (422): treat it as success so the
      // page never reveals whether an account exists.
      sendMagicLink: async (email, redirectPath) => {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: absolute(safeRedirect(redirectPath ?? null)) },
        })
        if (error && (error.code === 'otp_disabled' || (error.status === 422 && /signups not allowed/i.test(error.message)))) {
          return null
        }
        return toNeutralCode(error)
      },
      sendPasswordReset: async (email) =>
        toNeutralCode(
          (await supabase.auth.resetPasswordForEmail(email, { redirectTo: absolute('/reinitialiser-mot-de-passe') })).error,
        ),
      updatePassword: async (password) => toCode((await supabase.auth.updateUser({ password })).error),
      // "Se déconnecter" signs out THIS device only, and must always work — reception PCs are shared,
      // so a failed call (offline, server error, lock timeout) must never leave the next person
      // signed in as the previous one. When the server can't be reached, the local session is
      // forgotten anyway; its refresh token stays valid server-side until it expires.
      signOut: async () => {
        try {
          try {
            const { error } = await supabase.auth.signOut({ scope: 'local' })
            if (!error) return
          } catch {
            // Fall through to forgetting the local session.
          }
          await forgetLocalSession()
          // A concurrent token refresh may have re-saved the session in the meantime.
          const stillStored = await supabase.auth.getSession().then(
            ({ data }) => Boolean(data.session),
            () => true,
          )
          if (stillStored) await forgetLocalSession()
        } finally {
          sessionRef.current = null
          setSession(null)
          setIsRecovery(false)
        }
      },
    }),
    [session, isLoading, isRecovery],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
