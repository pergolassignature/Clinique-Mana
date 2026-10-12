import { MessageSquareText } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/**
 * Module Communications (plan §11): the clinic's Gmail mailboxes (`info@`, `administration@`),
 * the inbox « Courriels » (CM2), the composer (CM3), « Rédiger avec l'IA » (CM4) and the SMS
 * (batch SM: « Textos » and Paramètres → Textos). Depends on core only; Clients is optional
 * (linking threads to records).
 */
export const communicationsManifest: ModuleManifest = {
  key: 'communications',
  labelKey: 'modules.communications.name',
  dependsOn: [],
  nav: [
    // « Textos » (batch SM): the conversations with the clinic's SMS number.
    { path: '/textos', labelKey: 'modules.communications.sms.nav', icon: MessageSquareText, permission: 'communications.sms', order: 21 },
  ],
  routes: [{ path: 'textos', permission: 'communications.sms', component: lazyPage(() => import('./pages/SmsPage'), 'SmsPage') }],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.communicationsAuditLabels),
  settingsSections: [
    {
      // Paramètres → Textos (batch SM): the PBX, the webhook, the automatic texts, the test.
      id: 'sms',
      path: 'textos',
      labelKey: 'modules.communications.sms.settings.title',
      icon: MessageSquareText,
      permission: 'communications.sms_manage',
      editPermission: 'communications.sms_manage',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/SmsSettingsPage'), 'SmsSettingsPage'),
    },
  ],
}
