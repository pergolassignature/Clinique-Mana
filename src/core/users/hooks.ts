import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys, useAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  clearPermissionOverride,
  fetchOrgUsers,
  fetchPermissionCatalog,
  fetchUserOverrides,
  setPermissionOverride,
  setUserRole,
  setUserStatus,
  type UserStatus,
} from './api'
import { overrideStateOf, type OverrideState, type PermissionOverride } from './permissions'

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
  overrides: (userId: string) => [...userKeys.all, 'overrides', userId] as const,
}

/** The permission catalogue has its own root: user changes never touch it. */
export const permissionCatalogKeys = {
  all: ['permission-catalog'] as const,
}

/** Always fresh on mount: another manager may have changed someone meanwhile. */
export function useOrgUsers() {
  return useQuery({ queryKey: userKeys.list(), queryFn: fetchOrgUsers, staleTime: 0 })
}

/** The permission catalogue changes only with a migration: fresh for five minutes. */
export function usePermissionCatalog() {
  return useQuery({ queryKey: permissionCatalogKeys.all, queryFn: fetchPermissionCatalog, staleTime: 5 * 60_000 })
}

/** Refetched each time a sheet opens. */
export function useUserOverrides(userId: string | undefined) {
  return useQuery({
    queryKey: userKeys.overrides(userId ?? ''),
    queryFn: () => fetchUserOverrides(userId ?? ''),
    enabled: userId !== undefined,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/** The user's list row and overrides, plus the access payload if the target is the caller (the guards refuse that). */
function invalidateUser(queryClient: QueryClient, userId: string, callerId: string | undefined) {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: userKeys.list() }),
    queryClient.invalidateQueries({ queryKey: userKeys.overrides(userId) }),
  ]
  if (userId === callerId) invalidations.push(queryClient.invalidateQueries({ queryKey: accessKeys.all }))
  return Promise.all(invalidations)
}

/**
 * The toast for a failed user-admin change. A `42501` means the caller's own rights changed
 * elsewhere (e.g. their users.manage was revoked): their access payload is refreshed too.
 */
function onUserMutationError(queryClient: QueryClient, error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '42501') {
    void queryClient.invalidateQueries({ queryKey: accessKeys.all })
  }
  toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
}

/**
 * A role or status change: invalidates the user (awaited, so the mutation stays pending until the
 * fresh state is cached). Toasts live in the mutation options so the outcome shows even if the
 * sheet closes first.
 */
function useUserMutation<V extends { userId: string }>(mutationFn: (variables: V) => Promise<void>, successMessage: (variables: V) => string) {
  const queryClient = useQueryClient()
  const { access } = useAccess()
  return useMutation({
    mutationFn,
    onSuccess: async (_data, variables) => {
      await invalidateUser(queryClient, variables.userId, access?.user_id)
      toast.success(successMessage(variables))
    },
    onError: (error) => onUserMutationError(queryClient, error),
  })
}

export function useSetUserRole() {
  return useUserMutation(
    ({ userId, role }: { userId: string; role: string }) => setUserRole(userId, role),
    () => t('settings.users.sheet.role.saved'),
  )
}

export function useSetUserStatus() {
  return useUserMutation(
    ({ userId, status }: { userId: string; status: UserStatus }) => setUserStatus(userId, status),
    ({ status }) => t(status === 'active' ? 'settings.users.sheet.status.enabledSaved' : 'settings.users.sheet.status.disabledSaved'),
  )
}

/** The overrides with `key` set to `state` (removed for `role`). */
function withState(overrides: PermissionOverride[], key: string, state: OverrideState): PermissionOverride[] {
  const others = overrides.filter((o) => o.permission_key !== key)
  return state === 'role' ? others : [...others, { permission_key: key, granted: state === 'granted' }]
}

interface PermissionStateVariables {
  key: string
  state: OverrideState
  /** The permission's description, named in the toast. */
  label: string
}

/**
 * Sets one permission's state: back to the role default (clears the override), granted or revoked.
 * Optimistic: the overrides cache shows the new state at once; on failure only this permission
 * goes back (another row may be saving too). The user is refetched once the last change for them
 * has settled, so a refetch never overwrites a change still in flight.
 */
export function useSetPermissionState(userId: string) {
  const queryClient = useQueryClient()
  const { access } = useAccess()
  const mutationKey = [...userKeys.overrides(userId), 'set'] as const
  return useMutation({
    mutationKey,
    mutationFn: ({ key, state }: PermissionStateVariables) =>
      state === 'role' ? clearPermissionOverride(userId, key) : setPermissionOverride(userId, key, state === 'granted'),
    onMutate: async ({ key, state }) => {
      await queryClient.cancelQueries({ queryKey: userKeys.overrides(userId) })
      const previous = overrideStateOf(key, queryClient.getQueryData<PermissionOverride[]>(userKeys.overrides(userId)) ?? [])
      queryClient.setQueryData<PermissionOverride[]>(userKeys.overrides(userId), (cached) => withState(cached ?? [], key, state))
      return { previous }
    },
    onSuccess: (_data, { label, state }) => {
      toast.success(t('settings.users.sheet.permissions.saved', { permission: label, state: t(`settings.users.sheet.permissions.states.${state}`) }))
    },
    onError: (error, { key }, context) => {
      if (context) queryClient.setQueryData<PermissionOverride[]>(userKeys.overrides(userId), (cached) => withState(cached ?? [], key, context.previous))
      onUserMutationError(queryClient, error)
    },
    onSettled: async () => {
      // This mutation still counts as running here: refetch only after the last one.
      if (queryClient.isMutating({ mutationKey }) === 1) await invalidateUser(queryClient, userId, access?.user_id)
    },
  })
}
