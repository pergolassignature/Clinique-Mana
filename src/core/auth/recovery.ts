import type { Session } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY } from '@/core/supabase/client'

/**
 * Password-recovery mode, bound to the recovery session itself.
 *
 * auth-js emits PASSWORD_RECOVERY only once, in the tab that opened the link, so the mode must be
 * remembered: a reload or a second tab would otherwise get a normal, fully usable session. The
 * marker holds the recovery session's JWT `session_id`, which GoTrue keeps across token refreshes
 * and renews on every sign-in (checked on v2.197) — so a later, ordinary sign-in never matches.
 * Recovery and magic-link tokens both carry `amr: [{ method: 'otp' }]`, so the token alone can't tell.
 */
export const RECOVERY_STORAGE_KEY = `${AUTH_STORAGE_KEY}-recovery`

let memory: string | null = null // fallback when storage is blocked (this tab only)

/** JWT `session_id`: kept across refreshes, new for every sign-in. */
export function sessionIdOf(accessToken: string | null | undefined): string | null {
  const part = accessToken?.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { session_id?: unknown }
    return typeof claims.session_id === 'string' ? claims.session_id : null
  } catch {
    return null
  }
}

export function setRecoveryMarker(sessionId: string | null): void {
  memory = sessionId
  try {
    if (sessionId) localStorage.setItem(RECOVERY_STORAGE_KEY, sessionId)
    else localStorage.removeItem(RECOVERY_STORAGE_KEY)
  } catch {
    // Storage blocked: this tab still has `memory`.
  }
}

export function isRecoverySession(session: Session | null): boolean {
  const id = sessionIdOf(session?.access_token)
  if (!id) return false
  let stored: string | null
  try {
    stored = localStorage.getItem(RECOVERY_STORAGE_KEY)
  } catch {
    stored = memory
  }
  return stored === id
}
