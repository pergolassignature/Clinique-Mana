// SUPABASE_ALLOWED: the auth provider owns the Supabase auth session.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import type { AuthError, Session } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, supabase } from '@/core/supabase/client'
import { AuthContext, type AuthContextValue, type AuthErrorCode } from './auth-context'
import { isRecoverySession, RECOVERY_STORAGE_KEY, sessionIdOf, setRecoveryMarker } from './recovery'
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
    case 'reauthentication_not_valid':
      return 'invalid_code'
    case 'email_address_invalid':
      return 'invalid_email'
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
  if (error?.code === 'over_email_send_rate_limit') {
    // Same code when the project-wide email quota is spent: nobody receives emails any more.
    // Still neutral for the user, but visible to us.
    if (/email rate limit exceeded/i.test(error.message)) Sentry.captureMessage('Auth email quota exceeded', 'warning')
    return null
  }
  return toCode(error)
}

const absolute = (path: string) => `${window.location.origin}${path}`

/** Where an explicit sign-out lands (decision #17). */
const LOGIN_PATH = '/connexion'

// TRANSITION (Phase 3, ADR 0006 amendment): emails now link to /connexion/confirmer?token_hash=…
// Remove this reader one release after the new templates are live on staging.
//
// auth-js emits PASSWORD_RECOVERY once, possibly before our listener is registered, so the
// recovery link's URL hash (implicit flow) is read when this module is evaluated. That is always
// before auth-js strips it: auth-js clears the hash only after awaiting the server (auth-js 2.90).
// The marker binds recovery mode to that session (see recovery.ts). An expired or already used
// link lands with `#error=…&error_code=…` and no `type=recovery`, so it marks nothing.
if (typeof window !== 'undefined') {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  if (hash.get('type') === 'recovery') setRecoveryMarker(sessionIdOf(hash.get('access_token')))
}

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
  const [signedOutHere, setSignedOutHere] = useState(false)
  // Set when an explicit sign-out has finished: the page then loads /connexion afresh.
  const [reloadToLogin, setReloadToLogin] = useState(false)
  const sessionRef = useRef<Session | null>(null)

  useEffect(() => {
    // auth-js always emits INITIAL_SESSION on subscribe (with null on error), so no getSession() call.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMarker(sessionIdOf(next?.access_token))
      else if (event === 'USER_UPDATED' || event === 'SIGNED_OUT') setRecoveryMarker(null)
      // Derived on every event, so a reload or another tab of the recovery session stays in recovery.
      setIsRecovery(isRecoverySession(next))
      if (next) setSignedOutHere(false)

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

  // After an explicit sign-out, a full page load of /connexion (decisions #10, #17): a shared PC
  // picks up a new deploy, and nothing of the previous user stays in memory. An effect, so it runs
  // once the signed-out render has committed: the signed-in app (and its unsaved-changes
  // beforeunload prompt) is already gone. replace(): Back does not return to a signed-in page.
  useEffect(() => {
    if (reloadToLogin) window.location.replace(LOGIN_PATH)
  }, [reloadToLogin])

  // Another tab set or cleared the marker (or cleared all storage: key null).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === RECOVERY_STORAGE_KEY || e.key === null) setIsRecovery(isRecoverySession(sessionRef.current))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    /** What every sign-out of this tab ends with: no session, no recovery mode. */
    const forgetSessionState = () => {
      setRecoveryMarker(null)
      sessionRef.current = null
      setSession(null)
      setIsRecovery(false)
    }

    return {
      session,
      isLoading,
      isRecovery,
      signedOutHere,
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
      updatePassword: async (password, nonce) => {
        // Read before the update: its USER_UPDATED event clears the recovery marker.
        const wasRecovery = isRecoverySession(sessionRef.current)
        const code = toCode((await supabase.auth.updateUser(nonce ? { password, nonce } : { password })).error)
        // A recovery link means the password may be known to someone else: end every other session.
        // Best effort — the new password is already saved, so a failure here is only reported.
        if (!code && wasRecovery) {
          try {
            const { error } = await supabase.auth.signOut({ scope: 'others' })
            if (error) Sentry.captureException(error, { tags: { area: 'auth' } })
          } catch (error) {
            Sentry.captureException(error, { tags: { area: 'auth' } })
          }
        }
        return code
      },
      sendReauthenticationCode: async () => toCode((await supabase.auth.reauthenticate()).error),
      // Neutral too (decision #38, ADR 0006): an address used by another account answers like a
      // success, so « Mon compte » never reveals that an account exists. So does the per-user email
      // throttle: GoTrue checks for a duplicate before it, so reporting the throttle would turn each
      // request made within the window into a « taken or not » answer.
      updateEmail: async (email) => {
        const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: absolute('/mon-compte') })
        // By message too, for servers that send no error code (as for the magic link above).
        if (error && (error.code === 'email_exists' || (error.status === 422 && /already been registered/i.test(error.message)))) {
          return null
        }
        return toNeutralCode(error)
      },
      // "Se déconnecter" signs out THIS device only, and must always work — reception PCs are shared,
      // so a failed call (offline, server error, lock timeout) must never leave the next person
      // signed in as the previous one. When the server can't be reached, the local session is
      // forgotten anyway; its refresh token stays valid server-side until it expires.
      signOut: async ({ reload = true } = {}) => {
        // First, so whichever render sees the session gone already knows the sign-out was explicit.
        setSignedOutHere(true)
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
          forgetSessionState()
          if (reload) setReloadToLogin(true)
        }
      },
      // « Se déconnecter de tous les appareils » (« Mon compte », decision #33): revokes every refresh
      // token of the account. Access tokens already issued elsewhere stay valid until they expire
      // (jwt_expiry, 1 h). Unlike signOut, a failure keeps this session: forgetting it would hide
      // that the other devices are still signed in. Note that auth-js reports success, and clears
      // the session locally, when the server answers 401/403/404: that means « this session is
      // already gone », not necessarily that every other session was revoked.
      signOutEverywhere: async () => {
        // First, as in signOut: auth-js emits SIGNED_OUT before this call returns.
        setSignedOutHere(true)
        let failure: unknown = null
        let code: AuthErrorCode | null
        try {
          const { error } = await supabase.auth.signOut({ scope: 'global' })
          failure = error
          code = toCode(error)
        } catch (error) {
          failure = error
          code = 'unknown'
        }
        if (code) {
          // Throttling is expected; anything else is worth hearing about.
          if (code === 'unknown') Sentry.captureException(failure, { tags: { area: 'auth' } })
          setSignedOutHere(false)
          return code
        }
        // Again: a token refresh during the call emits a session, which resets the flag.
        setSignedOutHere(true)
        forgetSessionState()
        setReloadToLogin(true)
        return null
      },
      // The page sets the recovery marker from the returned token: PASSWORD_RECOVERY (emitted by
      // verifyOtp for type 'recovery') reaches this tab only, possibly after the guard has run.
      verifyEmailLink: async (tokenHash, type) => {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        if (!error) return { ok: true, sessionAccessToken: data.session?.access_token ?? null }
        // GoTrue answers 403 otp_expired for an expired, used or unknown token alike.
        const code = error.code === 'otp_expired' || (!error.code && error.status === 403) ? 'link_invalid' : (toCode(error) ?? 'unknown')
        return { ok: false, code }
      },
    }
  }, [session, isLoading, isRecovery, signedOutHere])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
