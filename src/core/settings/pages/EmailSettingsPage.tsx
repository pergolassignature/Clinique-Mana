import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmailKeysCard } from '@/core/email/components/EmailKeysCard'
import { EmailLogTable } from '@/core/email/components/EmailLogTable'
import { SenderCard } from '@/core/email/components/SenderCard'
import { TemplateEditorSheet } from '@/core/email/components/TemplateEditorSheet'
import { TemplatesTable } from '@/core/email/components/TemplatesTable'
import { useEmailSender, useEmailTemplates } from '@/core/email/hooks'
import { useSettingsSection } from '@/core/settings/section-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface } from '@/shared/components/SettingsCard'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

type Tab = 'settings' | 'templates' | 'log'
const TABS: Tab[] = ['settings', 'templates', 'log']
const isTab = (value: string): value is Tab => (TABS as string[]).includes(value)

/**
 * Paramètres → Courriels (`settings.view`). Three tabs (decision #35):
 * - « Réglages »: the sender (`settings.email_manage`) and « Envoi et webhook » (domain, Resend
 *   keys, webhook address and last event; `settings.integrations_manage`);
 * - « Modèles »: the templates by module; a row opens the editor with its live preview (read-only
 *   without `settings.email_manage`, the preview still works);
 * - « Historique d'envoi »: only with `settings.email_manage`, which is what lets the send log show
 *   recipient addresses for every template.
 * The section is read-only (the lock, one notice) only without either edit permission; otherwise
 * each part follows its own, as « Utilisateurs et accès » does.
 */
export function EmailSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { can } = useAccess()
  const canManageEmail = can('settings.email_manage')
  const canManageKeys = can('settings.integrations_manage')
  const tabs = TABS.filter((value) => value !== 'log' || canManageEmail)
  const [selected, setTab] = useState<Tab>('settings')
  const tab = tabs.includes(selected) ? selected : 'settings'
  // A tab's cards unmount when another tab opens: their unsaved edits would go silently.
  const { onValueChange, triggerProps } = useGuardedTabs(tab, isTab, setTab)

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t('settings.sections.email')} description={t('settings.email.description')} />
      {readOnly && <ReadOnlyNotice />}
      <Tabs value={tab} onValueChange={onValueChange}>
        <TabsList>
          {tabs.map((value) => (
            <TabsTrigger key={value} value={value} {...triggerProps(value)}>
              {t(`settings.email.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="settings" className="mt-5">
          <SectionSurface>
            <SettingsTab canManageEmail={canManageEmail} canManageKeys={canManageKeys} />
          </SectionSurface>
        </TabsContent>
        <TabsContent value="templates" className="mt-5 space-y-5">
          {!readOnly && !canManageEmail && <ReadOnlyNotice />}
          <TemplatesTab canManageEmail={canManageEmail} />
        </TabsContent>
        {canManageEmail && (
          <TabsContent value="log" className="mt-5">
            <EmailLogTable />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

/** Both cards mount together, so the sender, the secret keys and the last event load in parallel. */
function SettingsTab({ canManageEmail, canManageKeys }: { canManageEmail: boolean; canManageKeys: boolean }) {
  const { data: sender, isPending, isError, isFetching, refetch } = useEmailSender()
  return (
    <>
      {isPending ? (
        <Loading />
      ) : isError && !sender ? (
        <LoadError message={t('settings.email.sender.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
      ) : (
        <SenderCard sender={sender} readOnly={!canManageEmail} />
      )}
      <EmailKeysCard readOnly={!canManageKeys} />
    </>
  )
}

function TemplatesTab({ canManageEmail }: { canManageEmail: boolean }) {
  const { data: templates, isPending, isError, isFetching, refetch } = useEmailTemplates()
  const [openKey, setOpenKey] = useState<string | null>(null)
  // The row's button that opened the editor: focus returns there when it closes.
  const trigger = useRef<HTMLButtonElement | null>(null)
  // From the list, so the editor follows the stored text after a save or a reset.
  const open = templates?.find((template) => template.key === openKey) ?? null

  if (isPending) return <Loading />
  if (isError && !templates) {
    return <LoadError message={t('settings.email.templates.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
  }
  if (templates.length === 0) return <EmptyState title={t('settings.email.templates.empty')} />
  return (
    <>
      <TemplatesTable
        templates={templates}
        onOpen={(key, button) => {
          trigger.current = button
          setOpenKey(key)
        }}
      />
      <TemplateEditorSheet
        template={open}
        readOnly={!canManageEmail}
        onClose={() => setOpenKey(null)}
        returnFocus={() => {
          if (trigger.current?.isConnected) trigger.current.focus()
        }}
      />
    </>
  )
}
