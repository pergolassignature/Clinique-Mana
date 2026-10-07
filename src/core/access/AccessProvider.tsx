import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/core/auth/AuthProvider'
import { getClinicTimezone, resetClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { can, type Access, type AccessProblem, type AccessResult } from './access'
import { fetchMyAccess } from './api'

// The clinic timezone must be set BEFORE the signed-in tree renders (status 'ready'),
// so it is applied inside the query function, not in an effect.
async function loadAccess(): Promise<AccessResult> {
  const result = await fetchMyAccess()
  if ('access' in result) setClinicTimezone(result.access.org_timezone)
  return result
}

export type AccessStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error'

export interface AccessContextValue {
  status: AccessStatus
  access: Access | null
  problem: AccessProblem | null
  can: (permission: string) => boolean
  reload: () => void
}

export const accessKeys = {
  all: ['access'] as const,
  me: (userId: string) => [...accessKeys.all, 'me', userId] as const,
}

export const AccessContext = createContext<AccessContextValue | undefined>(undefined)

export function AccessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: accessKeys.me(userId ?? 'anonymous'),
    queryFn: loadAccess,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const access = data && 'access' in data ? data.access : null
  const problem = data && 'problem' in data ? data.problem : null

  // Idempotent re-sync: covers a cached access result reused after a sign-out/sign-in
  // within staleTime (loadAccess would not re-run).
  if (access && getClinicTimezone() !== access.org_timezone) setClinicTimezone(access.org_timezone)

  useEffect(() => {
    if (!userId) resetClinicTimezone()
  }, [userId])

  // Never degrade silently: a failed load is an error state with a retry, not "no permissions".
  const status: AccessStatus = !userId ? 'idle' : isError ? 'error' : isPending ? 'loading' : problem ? 'denied' : 'ready'

  const value = useMemo<AccessContextValue>(
    () => ({ status, access, problem, can: (permission) => can(access, permission), reload: () => void refetch() }),
    [status, access, problem, refetch],
  )

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export function useAccess(): AccessContextValue {
  const context = useContext(AccessContext)
  if (!context) throw new Error('useAccess must be used within AccessProvider')
  return context
}
