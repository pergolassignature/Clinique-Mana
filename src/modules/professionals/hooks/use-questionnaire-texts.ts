import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { fetchQuestionnaireSectionTexts, saveQuestionnaireSectionText } from '../api/questionnaire-texts'
import { professionalsSettingsKeys } from './keys'

const S = 'modules.professionals.settings.questionnaireTexts'

/**
 * The questionnaire's wording as the clinic reworded it (P4-562). Read by the questionnaire and by
 * the settings screen; the app's own text is the default, so an empty answer is not an error.
 */
export function useQuestionnaireSectionTexts() {
  return useQuery({ queryKey: professionalsSettingsKeys.questionnaireTexts(), queryFn: fetchQuestionnaireSectionTexts })
}

export function useSaveQuestionnaireSectionText() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ section, title, description }: { section: string; title: string; description: string }) =>
      saveQuestionnaireSectionText(section, title, description),
    onSuccess: () => {
      toast.success(t(`${S}.saved`))
      return queryClient.invalidateQueries({ queryKey: professionalsSettingsKeys.questionnaireTexts() })
    },
    onError: (error) => toast.error(moduleErrorMessage(error, t(`${S}.saveError`), 'professionals')),
  })
}
