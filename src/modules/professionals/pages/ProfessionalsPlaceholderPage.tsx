import { t } from '@/i18n'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { usePageTitle } from '@/shared/lib/use-page-title'

// Replaced in Phase 4 by the real module (design §5).
export default function ProfessionalsPlaceholderPage() {
  usePageTitle(t('modules.professionals.name'))
  return <FullPageMessage title={t('modules.professionals.name')} body={t('modules.professionals.placeholder')} />
}
