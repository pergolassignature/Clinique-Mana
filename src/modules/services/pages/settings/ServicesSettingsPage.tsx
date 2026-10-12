import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { BillingPolicyCard } from '../../components/settings/BillingPolicyCard'
import { CatalogueCard } from '../../components/settings/CatalogueCard'
import { PricesCard } from '../../components/settings/PricesCard'
import { RateVariantsCard } from '../../components/settings/RateVariantsCard'
import { useServicesSettings } from '../../hooks/use-services'

const S = 'modules.services.settings'

/**
 * Paramètres → Services et tarifs (plan S3.2; UI-4: the section title is the page's H1): the
 * catalogue, the student and reduced rates, the cancellation policy and the prices per
 * profession. Seen as the manifest says (S-8), changed with `services.manage` (else the one « Lecture
 * seule » notice and no action).
 */
export function ServicesSettingsPage() {
  const { readOnly } = useSettingsSection()
  const settings = useServicesSettings()
  usePageTitle(t(`${S}.title`))

  let content
  if (settings.data) {
    const canEdit = !readOnly
    content = (
      <>
        <CatalogueCard data={settings.data} canEdit={canEdit} />
        <RateVariantsCard data={settings.data} canEdit={canEdit} />
        <BillingPolicyCard data={settings.data} canEdit={canEdit} />
        <PricesCard data={settings.data} />
      </>
    )
  } else if (settings.isError) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else {
    content = <Loading />
  }

  return (
    <div className="space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      {content}
    </div>
  )
}
