import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import type { OverrideState } from './permissions'

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
  catalog: () => [...userKeys.all, 'catalog'] as const,
  overrides: (userId: string) => [...userKeys.all, 'overrides', userId] as const,
}

export function useOrgUsers() {
  return useQuery({ queryKey: userKeys.list(), queryFn: fetchOrgUsers })
}

/** The permission catalogue changes only with a migration: fresh for five minutes. */
export function usePermissionCatalog() {
  return useQuery({ queryKey: userKeys.catalog(), queryFn: fetchPermissionCatalog, staleTime: 5 * 60_000 })
}

export function useUserOverrides(userId: string | undefined) {
  return useQuery({
    queryKey: userKeys.overrides(userId ?? ''),
    queryFn: () => fetchUserOverrides(userId ?? ''),
    enabled: userId !== undefined,
  })
}

/**
 * The shared outcome of the user-admin mutations: invalidate `userKeys.all` (awaited, so the
 * mutation stays pending until the fresh state is cached), and the access payload too if the
 * target is the caller (the guards refuse that; kept for safety). Toasts live in the mutation
 * options so the outcome shows even if the sheet closes first.
 */
function useUserMutation<V extends { userId: string }>(mutationFn: (variables: V) => Promise<void>, successMessage: (variables: V) => string) {
  const queryClient = useQueryClient()
  const { access } = useAccess()
  return useMutation({
    mutationFn,
    onSuccess: async (_data, variables) => {
      const invalidations = [queryClient.invalidateQueries({ queryKey: userKeys.all })]
      if (variables.userId === access?.user_id) invalidations.push(queryClient.invalidateQueries({ queryKey: accessKeys.all }))
      await Promise.all(invalidations)
      toast.success(successMessage(variables))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
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

/** Sets one permission's state: back to the role default (clears the override), granted or revoked. */
export function useSetPermissionState() {
  return useUserMutation(
    ({ userId, key, state }: { userId: string; key: string; state: OverrideState }) =>
      state === 'role' ? clearPermissionOverride(userId, key) : setPermissionOverride(userId, key, state === 'granted'),
    () => t('settings.users.sheet.permissions.saved'),
  )
}
