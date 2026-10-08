import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { FicheOptionsCard } from '../../components/settings/FicheOptionsCard'

const N = 'modules.professionals.settings.fiche'

/**
 * Paramètres → Fiche PDF (P4-353): what the fiche a conseillère gives a client shows. Seen by
 * whoever sees the module's lists, changed with `professionals.settings`.
 */
export function FicheSettingsPage() {
  const { readOnly } = useSettingsSection()
  return (
    <div className="max-w-form space-y-5">
      <PageHeader title={t(`${N}.title`)} description={t(`${N}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      <FicheOptionsCard readOnly={readOnly} />
    </div>
  )
}
