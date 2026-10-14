import type { ComponentType } from 'react'
import { t, type TranslationKey } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
import { useUrlParams } from '@/shared/lib/use-url-params'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { ReferenceListTabContext } from '../../components/settings/reference-list-tab'
import { ClientelesSettingsPage } from './ClientelesSettingsPage'
import { DeactivationReasonsSettingsPage } from './DeactivationReasonsSettingsPage'
import { LanguagesSettingsPage } from './LanguagesSettingsPage'
import { MotifsSettingsPage } from './MotifsSettingsPage'
import { ProfessionsSettingsPage } from './ProfessionsSettingsPage'

const L = 'modules.professionals.settings.lists'

/** The tabs, by their `?onglet=` word (the former sections' paths); the first one has none. */
const TABS: readonly { slug: string; labelKey: TranslationKey; Page: ComponentType }[] = [
  { slug: 'professions', labelKey: 'modules.professionals.settings.professions.title', Page: ProfessionsSettingsPage },
  { slug: 'clienteles', labelKey: 'modules.professionals.settings.clienteles.title', Page: ClientelesSettingsPage },
  { slug: 'motifs', labelKey: 'modules.professionals.settings.motifs.title', Page: MotifsSettingsPage },
  { slug: 'langues', labelKey: 'modules.professionals.settings.languages.title', Page: LanguagesSettingsPage },
  { slug: 'raisons-desactivation', labelKey: 'modules.professionals.settings.deactivationReasons.title', Page: DeactivationReasonsSettingsPage },
]
type Tab = (typeof TABS)[number]['slug']
const isTab = (value: string): value is Tab => TABS.some((tab) => tab.slug === value)

/**
 * Paramètres → Professionnels → « Listes » (NAV-3): the five reference lists, one real tab each
 * (page-level views, decision #35: one tab stop, the arrows switch), the tab in the address
 * (`?onglet=`, the former sections' paths redirect here). Each tab keeps its own cards and forms;
 * leaving a tab with unsaved changes asks first (`useGuardedTabs`). The permission is the lists'
 * (unchanged): the « Lecture seule » notice shows once, above the tabs.
 */
export function ListsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { params, update } = useUrlParams()
  const asked = params.get('onglet') ?? ''
  const tab: Tab = isTab(asked) ? asked : 'professions'
  const { onValueChange, triggerProps } = useGuardedTabs(tab, isTab, (next) => update({ onglet: next === 'professions' ? null : next }))
  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${L}.title`)} description={t(`${L}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      <Tabs value={tab} onValueChange={onValueChange}>
        <TabsList aria-label={t(`${L}.tabs`)}>
          {TABS.map(({ slug, labelKey }) => (
            <TabsTrigger key={slug} value={slug} {...triggerProps(slug)}>
              {t(labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        <ReferenceListTabContext.Provider value={true}>
          {TABS.map(({ slug, Page }) => (
            <TabsContent key={slug} value={slug} className="mt-5">
              <Page />
            </TabsContent>
          ))}
        </ReferenceListTabContext.Provider>
      </Tabs>
    </div>
  )
}
