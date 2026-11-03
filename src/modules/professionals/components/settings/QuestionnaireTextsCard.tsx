import { useState } from 'react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { LoadError } from '@/shared/components/LoadState'
import { Badge } from '@/shared/ui/badge'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { QUESTIONNAIRE_STEPS, type QuestionnaireStep } from '../../lib/questionnaire'
import { useQuestionnaireSectionTexts, useSaveQuestionnaireSectionText } from '../../hooks/use-questionnaire-texts'

const S = 'modules.professionals.settings.questionnaireTexts'
const Q = 'modules.professionals.questionnaire'

/**
 * One card per step of the questionnaire (P4-562): its title and its consigne, as the clinic wants
 * them. Both are empty until the clinic rewords one — the app's own text is shown underneath, and
 * clearing a field gives it back, so « Réinitialiser » needs no button of its own.
 */
function StepCard({ step, readOnly }: { step: QuestionnaireStep; readOnly: boolean }) {
  const texts = useQuestionnaireSectionTexts()
  const save = useSaveQuestionnaireSectionText()
  const stored = texts.data?.[step]
  const [title, setTitle] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  // null while untouched: the stored value is what the fields show.
  const titleValue = title ?? stored?.title ?? ''
  const descriptionValue = description ?? stored?.description ?? ''
  const dirty = (title !== null && title !== (stored?.title ?? '')) || (description !== null && description !== (stored?.description ?? ''))

  return (
    <SettingsCard
      title={t(`${Q}.steps.${step}.title`)}
      description={stored ? undefined : t(`${Q}.steps.${step}.description`)}
      dirty={dirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(
          { section: step, title: titleValue, description: descriptionValue },
          { onSuccess: () => { setTitle(null); setDescription(null) } },
        )
      }}
    >
      {stored && <Badge variant="info">{t(`${S}.reworded`)}</Badge>}
      <FormField label={t(`${S}.stepTitle`)} help={t(`${S}.appText`, { text: t(`${Q}.steps.${step}.title`) })}>
        {(field) => (
          <Input {...field} value={titleValue} onChange={(event) => setTitle(event.target.value)} maxLength={80} readOnly={readOnly} autoComplete="off" />
        )}
      </FormField>
      <FormField label={t(`${S}.stepDescription`)} help={t(`${S}.appText`, { text: t(`${Q}.steps.${step}.description`) })}>
        {(field) => (
          <Textarea {...field} value={descriptionValue} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={300} readOnly={readOnly} />
        )}
      </FormField>
    </SettingsCard>
  )
}

/** The whole questionnaire, one card per step, in the order the professional walks them. */
export function QuestionnaireTextsCard({ readOnly }: { readOnly: boolean }) {
  const texts = useQuestionnaireSectionTexts()
  if (texts.isError && !texts.data) {
    return <LoadError message={t(`${S}.loadError`)} onRetry={() => void texts.refetch()} retrying={texts.isFetching} />
  }
  return (
    <div className="space-y-5">
      {QUESTIONNAIRE_STEPS.map((step) => (
        <StepCard key={step} step={step} readOnly={readOnly} />
      ))}
    </div>
  )
}
