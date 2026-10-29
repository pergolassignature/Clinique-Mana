import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { QuestionnaireTextsCard } from '../../components/settings/QuestionnaireTextsCard'

const N = 'modules.professionals.settings.questionnaireTexts'

/**
 * Paramètres → « Consignes du questionnaire » (P4-562, Jonathan's question of 22 October 2026):
 * the title and the consigne the professional reads at each step, in the clinic's own words. Seen
 * by whoever sees the module's lists, changed with `professionals.settings`.
 */
export function QuestionnaireTextsSettingsPage() {
  const { readOnly } = useSettingsSection()
  return (
    <div className="max-w-form space-y-5">
      <PageHeader level={1} title={t(`${N}.title`)} description={t(`${N}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      <QuestionnaireTextsCard readOnly={readOnly} />
    </div>
  )
}
