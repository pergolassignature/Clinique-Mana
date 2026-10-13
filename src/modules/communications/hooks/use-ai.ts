import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { draftWithAi, fetchAiDraftStatus, fetchAiSettings, saveAiSettings, type AiDraftInput, type AiSettingsInput } from '../api/ai'
import { aiKeys } from './keys'

/** Whether the composer shows « Rédiger avec l'IA » (with communications.ai_draft only). */
export function useAiDraftStatus() {
  const { can } = useAccess()
  const allowed = can('communications.ai_draft')
  return useQuery({ queryKey: aiKeys.status(), queryFn: fetchAiDraftStatus, enabled: allowed, staleTime: 60_000 })
}

/** One draft (or a refinement); the status and the month's use read again after. */
export function useAiDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AiDraftInput) => draftWithAi(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiKeys.all }),
  })
}

/** Paramètres → IA (communications.ai_manage). */
export function useAiSettings() {
  return useQuery({ queryKey: aiKeys.settings(), queryFn: fetchAiSettings })
}

export function useSaveAiSettings({ onErrorMessage }: { onErrorMessage?: (message: string) => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AiSettingsInput) => saveAiSettings(input),
    onSuccess: () => toast.success(t('modules.communications.ai.settings.saved')),
    onError: (error) => {
      const message = moduleErrorMessage(error, t('modules.communications.ai.settings.saveError'), 'communications')
      if (onErrorMessage) onErrorMessage(message)
      else toast.error(message)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiKeys.all }),
  })
}
