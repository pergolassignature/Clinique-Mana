import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { listOrgSecretKeys, setOrgSecret } from './api'

export const secretKeys = {
  all: ['org-secrets'] as const,
  list: () => [...secretKeys.all, 'list'] as const,
}

/** The configured secrets of the caller's org (names and dates). */
export function useOrgSecretKeys() {
  return useQuery({ queryKey: secretKeys.list(), queryFn: listOrgSecretKeys })
}

/**
 * Sets a secret. `gcTime: 0`: the mutation carries the value, which must not stay in the cache
 * (CLAUDE.md §8, « Never cache a revealed sensitive value »). Toasts here, so the outcome shows
 * even if the field unmounts first.
 */
export function useSetOrgSecret() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => setOrgSecret(key, value),
    gcTime: 0,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: secretKeys.all })
      toast.success(t('settings.secrets.saved'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('settings.secrets.saveError'), 'settings'))
    },
  })
}
