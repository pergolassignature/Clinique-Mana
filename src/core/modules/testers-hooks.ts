import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { toast } from '@/shared/ui/sonner'
import { moduleErrorMessage } from './errors'
import { moduleKeys } from './hooks'
import {
  addModuleTester,
  fetchModuleTesters,
  removeModuleTester,
  setModuleTestersOnly,
} from './testers-api'

/** Under `moduleKeys.all`: a module toggle refetches the testers too. */
export const moduleTesterKeys = {
  all: [...moduleKeys.all, 'testers'] as const,
}

export function useModuleTesters() {
  return useQuery({
    queryKey: moduleTesterKeys.all,
    queryFn: fetchModuleTesters,
  })
}

/**
 * A change of who may use a module: the testers and the caller's own access are refetched
 * (awaited, so the switch shows the saved state), the toast says it; a refusal is shown as is.
 */
function useTestersMutation<V>(
  mutationFn: (variables: V) => Promise<void>,
  successKey:
    | 'settings.modules.testers.saved'
    | 'settings.modules.testers.added'
    | 'settings.modules.testers.removed'
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: moduleTesterKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.all }),
      ])
      toast.success(t(successKey))
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: moduleTesterKeys.all })
      toast.error(
        moduleErrorMessage(error, t('settings.modules.error'), 'settings')
      )
    },
  })
}

export function useSetModuleTestersOnly() {
  return useTestersMutation(
    ({ key, testersOnly }: { key: string; testersOnly: boolean }) =>
      setModuleTestersOnly(key, testersOnly),
    'settings.modules.testers.saved'
  )
}

export function useAddModuleTester() {
  return useTestersMutation(
    ({ key, userId }: { key: string; userId: string }) =>
      addModuleTester(key, userId),
    'settings.modules.testers.added'
  )
}

export function useRemoveModuleTester() {
  return useTestersMutation(
    ({ key, userId }: { key: string; userId: string }) =>
      removeModuleTester(key, userId),
    'settings.modules.testers.removed'
  )
}
