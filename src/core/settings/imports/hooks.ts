import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { fetchImportsStatus, setImportsOpen } from './api'

export const importsStatusKeys = {
  all: ['imports-status'] as const,
  status: () => [...importsStatusKeys.all, 'status'] as const,
}

/** The GOrendezvous imports switch (`modules.manage`): pass `enabled: false` without it. */
export function useImportsStatus({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: importsStatusKeys.status(), queryFn: fetchImportsStatus, enabled })
}

/**
 * Closes or reopens the imports. Stays pending until the fresh state is in the cache; the toasts
 * live in the mutation options so the outcome shows even if the page unmounts first.
 */
export function useSetImportsOpen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (open: boolean) => setImportsOpen(open),
    onSuccess: async (_, open) => {
      await queryClient.invalidateQueries({ queryKey: importsStatusKeys.all })
      toast.success(t(open ? 'settings.modules.imports.reopened' : 'settings.modules.imports.closed'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('settings.modules.imports.error'), 'settings'))
    },
  })
}
