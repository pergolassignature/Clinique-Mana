import { t } from '@/i18n'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { usePageTitle } from '@/shared/lib/use-page-title'

/**
 * « En préparation » stand-ins, so the manifest declares every route and settings section now:
 * 4a.10 and 4a.11 replace the routes' page, 4a.6–4a.9 the sections'. This file goes in 4a.10.
 */
export function ProfessionalsPlaceholderPage() {
  usePageTitle(t('modules.professionals.name'))
  return <FullPageMessage title={t('modules.professionals.name')} body={t('modules.professionals.placeholder')} />
}

/** Inside « Paramètres », under the section's own title (the layout titles the tab). */
export function ProfessionalsSettingsPlaceholder() {
  return <FullPageMessage title={t('modules.professionals.name')} body={t('modules.professionals.settingsPlaceholder')} headingLevel={2} compact />
}
