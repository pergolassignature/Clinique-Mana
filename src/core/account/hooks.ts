import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { fetchAuthUser, updateDisplayName } from './api'

export const accountKeys = {
  all: ['account'] as const,
  authUser: (userId: string) => [...accountKeys.all, 'auth-user', userId] as const,
}

/**
 * The signed-in user read from GoTrue, for « Mon compte ». Always stale, so it is read again on
 * mount and when the window regains focus (e.g. back from the mailbox after confirming).
 */
export function useAuthUser(userId: string) {
  return useQuery({ queryKey: accountKeys.authUser(userId), queryFn: fetchAuthUser, staleTime: 0 })
}

/**
 * Renames the signed-in user. The shell shows the name from `get_my_access`, so the access payload
 * is refetched; the mutation stays pending until it is (a failed refetch does not reject). The
 * toasts live in the mutation options so the outcome shows even if the page unmounts first.
 */
export function useUpdateDisplayName() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, displayName }: { userId: string; displayName: string }) => updateDisplayName(userId, displayName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accessKeys.all })
      toast.success(t('account.name.saved'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'account'))
    },
  })
}
