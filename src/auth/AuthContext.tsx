import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import type { User, Session, AuthError as SupabaseAuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import type { Profile, AuthState, AuthError } from './types'

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<AuthError | null>(null)

  // Fetch profile with timeout
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (profileError) {
        console.error('[Auth] Profile fetch error:', profileError.message)
        return null
      }

      return data as Profile
    } catch (err) {
      console.error('[Auth] Profile fetch exception:', err)
      return null
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    const p = await fetchProfile(user.id)
    setProfile(p)
  }, [user, fetchProfile])

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: AuthError | null }> => {
      setIsLoading(true)
      setError(null)

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setIsLoading(false)
        const err = mapAuthError(authError)
        setError(err)
        return { error: err }
      }

      if (!data.user) {
        setIsLoading(false)
        setError('unknown')
        return { error: 'unknown' }
      }

      // Fetch profile
      console.log('[Auth] Fetching profile for user:', data.user.id)
      const userProfile = await fetchProfile(data.user.id)
      console.log('[Auth] Profile result:', userProfile)

      if (!userProfile) {
        console.error('[Auth] No profile found for user:', data.user.id, '- user needs to be added to profiles table')
        await supabase.auth.signOut()
        setIsLoading(false)
        setError('profile_not_found')
        return { error: 'profile_not_found' }
      }

      if (userProfile.status === 'disabled') {
        await supabase.auth.signOut()
        setIsLoading(false)
        setError('profile_disabled')
        return { error: 'profile_disabled' }
      }

      setUser(data.user)
      setSession(data.session)
      setProfile(userProfile)
      setIsLoading(false)

      return { error: null }
    },
    [fetchProfile]
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
    setError(null)
  }, [])

  // Initialize auth state
  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      try {
        // Get current session
        const { data: { session: currentSession } } = await supabase.auth.getSession()

        if (!mounted) return

        if (currentSession?.user) {
          // Try to fetch profile
          const userProfile = await fetchProfile(currentSession.user.id)

          if (!mounted) return

          if (userProfile && userProfile.status === 'active') {
            setUser(currentSession.user)
            setSession(currentSession)
            setProfile(userProfile)
          } else {
            // Profile missing or disabled - clear session
            await supabase.auth.signOut()
          }
        }

        setIsLoading(false)
      } catch (err) {
        console.error('[Auth] Init error:', err)
        if (mounted) setIsLoading(false)
      }
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return

        if (event === 'SIGNED_OUT') {
          setUser(null)
          setSession(null)
          setProfile(null)
          setError(null)
        } else if (event === 'TOKEN_REFRESHED' && newSession) {
          setSession(newSession)
        }
        // Don't handle SIGNED_IN here - let signIn() handle it
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  const value: AuthContextValue = {
    user,
    session,
    profile,
    isLoading,
    error,
    signIn,
    signOut,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

function mapAuthError(error: SupabaseAuthError): AuthError {
  if (error.message.includes('Invalid login credentials')) {
    return 'invalid_credentials'
  }
  return 'unknown'
}
