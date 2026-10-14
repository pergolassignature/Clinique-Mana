import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { usePageTabs } from '@/shared/lib/use-page-tabs'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { BillingPolicyCard } from '../../components/settings/BillingPolicyCard'
import { CatalogueCard } from '../../components/settings/CatalogueCard'
import { PricesCard } from '../../components/settings/PricesCard'
import { RateVariantsCard } from '../../components/settings/RateVariantsCard'
import { useServicesSettings } from '../../hooks/use-services'

const S = 'modules.services.settings'

/** The page's tabs, as `?onglet=` names them (NAV-4); « Catalogue » is the default. */
const TABS = ['catalogue', 'prix', 'tarifs-reduits', 'annulation'] as const

/**
 * Paramètres → Services et tarifs (plan S3.2; UI-4: the section title is the page's H1). Four
 * tabs (NAV-4, decision #35; `?onglet=`): « Catalogue », « Prix » (per profession today, the gaps
 * with GOrendezvous), « Tarifs étudiant et réduit » and « Politique d'annulation ». Seen as the
 * manifest says (S-8), changed with `services.manage` (else the one « Lecture seule » notice and
 * no action).
 */
export function ServicesSettingsPage() {
  const { readOnly } = useSettingsSection()
  const settings = useServicesSettings()
  const { tab, onValueChange, triggerProps } = usePageTabs(TABS)
  usePageTitle(t(`${S}.title`))

  let content
  if (settings.data) {
    const canEdit = !readOnly
    content = (
      <Tabs value={tab} onValueChange={onValueChange}>
        <TabsList aria-label={t(`${S}.tabs.list`)}>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value} {...triggerProps(value)}>
              {t(`${S}.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="catalogue" className="mt-5">
          <CatalogueCard data={settings.data} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="prix" className="mt-5">
          <PricesCard data={settings.data} />
        </TabsContent>
        <TabsContent value="tarifs-reduits" className="mt-5">
          <RateVariantsCard data={settings.data} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="annulation" className="mt-5">
          <BillingPolicyCard data={settings.data} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
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
