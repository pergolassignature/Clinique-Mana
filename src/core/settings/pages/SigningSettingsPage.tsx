import { useState } from 'react'
import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { DocumentTemplatesTable } from '@/core/signing/components/DocumentTemplatesTable'
import { SigningConnectionCard, SigningSendCard, SigningWebhookCard } from '@/core/signing/components/SigningSettingsCards'
import { UnverifiedRequestsCard } from '@/core/signing/components/UnverifiedRequestsCard'
import { useDocumentTemplates } from '@/core/signing/hooks'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface } from '@/shared/components/SettingsCard'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

type Tab = 'settings' | 'templates'
const TABS: Tab[] = ['settings', 'templates']
const isTab = (value: string): value is Tab => (TABS as string[]).includes(value)

/**
 * Paramètres → Signature électronique (`settings.view`; design §6.4). Two tabs:
 * - « Réglages »: « Connexion », « Webhook » and « Envoi », changed with
 *   `settings.integrations_manage` only (the section's edit permission: read-only without it, with
 *   one notice naming that right; the cards repeat nothing). The test tools and the last test
 *   document need it too, and so does « Demandes non vérifiées » above them: the requests the
 *   hourly reconcile has not read for over 6 hours (shown only when there are some), the list the
 *   « non vérifiées » notice links to;
 * - « Modèles de documents »: the templates the caller may see, read-only (Task 3.34 lists them;
 *   versions are edited with their module).
 */
export function SigningSettingsPage() {
  const { readOnly } = useSettingsSection()
  const [tab, setTab] = useState<Tab>('settings')
  // The « Réglages » cards unmount when the other tab opens: their unsaved edits would go silently.
  const { onValueChange, triggerProps } = useGuardedTabs(tab, isTab, setTab)

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t('settings.sections.signing')} description={t('settings.signing.description')} />
      {readOnly && <ReadOnlyNotice body={t('settings.signing.readOnlyNotice')} />}
      <Tabs value={tab} onValueChange={onValueChange}>
        <TabsList>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value} {...triggerProps(value)}>
              {t(`settings.signing.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="settings" className="mt-5 space-y-5">
          <UnverifiedRequestsCard enabled={!readOnly} />
          <SectionSurface>
            <SigningConnectionCard readOnly={readOnly} />
            <SigningWebhookCard readOnly={readOnly} />
            <SigningSendCard readOnly={readOnly} />
          </SectionSurface>
        </TabsContent>
        <TabsContent value="templates" className="mt-5 space-y-3">
          <p className="text-sm text-muted-foreground">{t('settings.signing.templates.description')}</p>
          <TemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TemplatesTab() {
  const { data: templates, isPending, isError, isFetching, refetch } = useDocumentTemplates()
  if (isPending) return <Loading />
  if (isError && !templates) {
    return <LoadError message={t('settings.signing.templates.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
  }
  if (templates.length === 0) return <EmptyState title={t('settings.signing.templates.empty')} body={t('settings.signing.templates.emptyHint')} />
  return <DocumentTemplatesTable templates={templates} />
}
