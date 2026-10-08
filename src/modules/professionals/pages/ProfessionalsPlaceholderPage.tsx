import { t } from '@/i18n'
import { FullPageMessage } from '@/shared/components/FullPageMessage'

/**
 * « En préparation » stand-in for the « Motifs » section, inside « Paramètres », under the
 * section's own title (the layout titles the tab). This file goes with 4a.9.
 */
export function ProfessionalsSettingsPlaceholder() {
  return <FullPageMessage title={t('modules.professionals.name')} body={t('modules.professionals.settingsPlaceholder')} headingLevel={2} compact />
}
