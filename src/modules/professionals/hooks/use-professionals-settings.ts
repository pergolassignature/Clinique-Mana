import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import { fetchProfessionalsSettings, saveProfessionalsSettings } from '../api/settings'
import type { ProfessionalsSettings } from '../api/parse'
import { professionalsSettingsKeys } from './keys'
import { showMutationError, type MutationFeedback } from './mutation-feedback'

/** The module's settings (`collectSin`…). */
export function useProfessionalsSettings() {
  return useQuery({ queryKey: professionalsSettingsKeys.settings(), queryFn: fetchProfessionalsSettings })
}

/** Saves the given keys; the RPC returns the effective settings, which replace the cached ones. */
export function useSaveProfessionalsSettings(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<ProfessionalsSettings>) => saveProfessionalsSettings(patch),
    onSuccess: (settings) => {
      queryClient.setQueryData(professionalsSettingsKeys.settings(), settings)
      toast.success(t('modules.professionals.toasts.saved'))
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
  })
}
