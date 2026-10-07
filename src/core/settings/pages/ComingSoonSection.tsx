import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { useSettingsSection } from '../section-context'

/** Temporary page for the sections later Phase 2 tasks build; removed in Task 2.18. */
export function ComingSoonSection() {
  const { section, readOnly } = useSettingsSection()
  return (
    <div className="max-w-form">
      <h2 className="text-lg font-semibold">{t(section.labelKey)}</h2>
      {readOnly && <ReadOnlyNotice className="mt-4" />}
      <EmptyState title={t('settings.comingSoon')} />
    </div>
  )
}
