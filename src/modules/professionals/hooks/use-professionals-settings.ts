import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import { fetchProfessionalsSettings, saveProfessionalsSettings } from '../api/settings'
import type { ProfessionalsSettings } from '../api/parse'
import { professionalsSettingsKeys } from './keys'
import { showMutationError, type MutationFeedback } from './mutation-feedback'

/** The module's settings query, shared by the screens and the fiche (which reads its render options, P4-353). */
export const professionalsSettingsQuery = queryOptions({ queryKey: professionalsSettingsKeys.settings(), queryFn: fetchProfessionalsSettings })
const settingsQuery = professionalsSettingsQuery

/** The module's settings (`collectSin`…). `enabled`: only for a screen that uses them. */
export function useProfessionalsSettings(enabled = true) {
  return useQuery({ ...settingsQuery, enabled })
}

/** On the « Rémunération et fiscalité » tab's hover or focus (the SIN card reads `collectSin`). */
export function prefetchProfessionalsSettings(queryClient: QueryClient): Promise<void> {
  return queryClient.prefetchQuery(settingsQuery)
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
