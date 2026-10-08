import { supabase } from '@/core/supabase/client'

/**
 * Calls `listener` with the session's user id (null once signed out) at every auth event: a
 * sign-out, a sign-in, or another tab of this browser switching the shared session. auth-js calls
 * it before React re-renders, so a writer can drop what it holds before the signed-in page unmounts
 * (`usePreferenceWriter`), and `AccessProvider` can clear the query cache before any query of the
 * previous user runs again.
 * Returns the unsubscribe function.
 */
export function onSessionUserChange(listener: (userId: string | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // The first report is not a change: when auth-js could not read the stored session it comes
    // with none, which must not drop what the signed-in user just chose.
    if (event === 'INITIAL_SESSION') return
    listener(session?.user.id ?? null)
  })
  return () => data.subscription.unsubscribe()
}
