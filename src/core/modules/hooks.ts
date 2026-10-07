import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accessKeys } from '@/core/access/access-context'
import { fetchModules, setModuleEnabled } from './api'

export const moduleKeys = {
  all: ['modules'] as const,
  list: () => [...moduleKeys.all, 'list'] as const,
}

export function useModules() {
  return useQuery({ queryKey: moduleKeys.list(), queryFn: fetchModules })
}

export function useSetModuleEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => setModuleEnabled(key, enabled),
    // Enabled module keys reach the app through get_my_access, so the access payload is stale too.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: moduleKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.all }),
      ]),
  })
}
