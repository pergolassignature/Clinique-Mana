import { createContext, useContext } from 'react'
import type { Access, AccessProblem } from './access'

export type AccessStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error'

export interface AccessContextValue {
  status: AccessStatus
  access: Access | null
  problem: AccessProblem | null
  can: (permission: string) => boolean
  reload: () => void
  /** True while access is being (re)fetched, e.g. after reload(). */
  isReloading: boolean
}

export const accessKeys = {
  all: ['access'] as const,
  me: (userId: string) => [...accessKeys.all, 'me', userId] as const,
}

export const AccessContext = createContext<AccessContextValue | undefined>(undefined)

export function useAccess(): AccessContextValue {
  const context = useContext(AccessContext)
  if (!context) throw new Error('useAccess must be used within AccessProvider')
  return context
}

/**
 * The verified access, for code rendered under RequireAuth (which only renders children once
 * access is ready). Throws otherwise, so a misplaced component fails loudly instead of
 * rendering without permissions.
 */
export function useReadyAccess(): Access {
  const { status, access } = useAccess()
  if (status !== 'ready' || !access) throw new Error(`useReadyAccess requires ready access (status: ${status})`)
  return access
}
