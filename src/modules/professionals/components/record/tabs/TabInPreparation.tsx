import { t } from '@/i18n'

/** Stand-in panel for a tab whose task comes later (4a.12–4a.15, 4a.18): each replaces its entry in `record-tabs.ts`. */
export function TabInPreparation() {
  return <p className="py-6 text-sm text-muted-foreground">{t('modules.professionals.record.tabInPreparation')}</p>
}
