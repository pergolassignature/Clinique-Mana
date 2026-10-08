import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { toast } from '@/shared/ui/sonner'
import { fetchModules, setModuleEnabled } from './api'
import { moduleErrorMessage } from './errors'

export const moduleKeys = {
  all: ['modules'] as const,
  list: () => [...moduleKeys.all, 'list'] as const,
}

export function useModules() {
  return useQuery({ queryKey: moduleKeys.list(), queryFn: fetchModules })
}

/**
 * Toggles a module. The toasts live here (mutation options, not per-call callbacks) so the
 * outcome is shown even if the page unmounts before the server answers.
 */
export function useSetModuleEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => setModuleEnabled(key, enabled),
    onSuccess: async () => {
      // Enabled module keys reach the app through get_my_access, so the access payload is stale too.
      // Awaited: the mutation stays pending until the fresh state is in the cache.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: moduleKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.all }),
      ])
      toast.success(t('settings.modules.saved'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('settings.modules.error'), 'settings'))
    },
  })
}
