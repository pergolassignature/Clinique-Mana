import { t } from '@/i18n'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { usePageTitle } from '@/shared/lib/use-page-title'

/**
 * « En préparation » stand-in, so the manifest declares every route now: 4a.10 and 4a.11 replace
 * it. This file goes in 4a.10.
 */
export function ProfessionalsPlaceholderPage() {
  usePageTitle(t('modules.professionals.name'))
  return <FullPageMessage title={t('modules.professionals.name')} body={t('modules.professionals.placeholder')} />
}

