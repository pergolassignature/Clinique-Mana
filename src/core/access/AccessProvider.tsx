import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ZodError } from 'zod'
import { useAuth } from '@/core/auth/AuthProvider'
import { getClinicTimezone, resetClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { can, type Access, type AccessProblem } from './access'
import { fetchMyAccess } from './api'

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

export function AccessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const queryClient = useQueryClient()
  const previousUserId = useRef(userId)

  // Shared reception PCs: when the signed-in user leaves (sign-out here or in another tab) or
  // changes, drop every cached query so nothing of theirs survives.
  // Declared BEFORE useQuery on purpose: effects run in declaration order, so the cache is cleared
  // before useQuery's own effect points the observer at the new user's query and starts its fetch.
  useEffect(() => {
    const previous = previousUserId.current
    previousUserId.current = userId
    if (previous && previous !== userId) queryClient.clear()
  }, [userId, queryClient])

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: accessKeys.me(userId ?? 'anonymous'),
    queryFn: fetchMyAccess,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    // An unexpected payload will not fix itself: only retry transient (network/server) errors.
    retry: (failureCount, error) => !(error instanceof ZodError) && failureCount < 1,
  })

  const access = data && 'access' in data ? data.access : null
  const problem = data && 'problem' in data ? data.problem : null

  // The clinic timezone must be set BEFORE the signed-in tree renders (status 'ready'): it is
  // synced here, during render, before children render. Idempotent (setClinicTimezone ignores repeats).
  if (access && getClinicTimezone() !== access.org_timezone) setClinicTimezone(access.org_timezone)

  useEffect(() => {
    if (!userId) resetClinicTimezone()
  }, [userId])

  // Never degrade silently: a failed first load is an error state with a retry, not "no permissions".
  // A failed background refetch keeps the access already verified for this user.
  const status: AccessStatus = !userId
    ? 'idle'
    : isError && !data
      ? 'error'
      : isPending
        ? 'loading'
        : problem
          ? 'denied'
          : 'ready'

  const value = useMemo<AccessContextValue>(
    () => ({
      status,
      access,
      problem,
      can: (permission) => can(access, permission),
      reload: () => void refetch(),
      isReloading: isFetching,
    }),
    [status, access, problem, refetch, isFetching],
  )

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export function useAccess(): AccessContextValue {
  const context = useContext(AccessContext)
  if (!context) throw new Error('useAccess must be used within AccessProvider')
  return context
}
