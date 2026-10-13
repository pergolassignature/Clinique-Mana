import { Mail, MessageSquareText } from 'lucide-react'
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
    // « Courriels » (CM2): the clinic's Gmail mailboxes, read in the app.
    { path: '/courriels', labelKey: 'modules.communications.inbox.menu', icon: Mail, permission: 'communications.inbox', order: 20 },
    // « Textos » (batch SM): the conversations with the clinic's SMS number.
    { path: '/textos', labelKey: 'modules.communications.sms.nav', icon: MessageSquareText, permission: 'communications.sms', order: 21 },
  ],
  routes: [
    { path: 'courriels', permission: 'communications.inbox', component: lazyPage(() => import('./pages/InboxPage'), 'InboxPage') },
    { path: 'textos', permission: 'communications.sms', component: lazyPage(() => import('./pages/SmsPage'), 'SmsPage') },
    // Where Google sends the browser back after « Connecter une boîte » (CM1): fixed, the
    // functions build the same address from APP_URL (`_shared/gmail/env.ts` RETURN_PATH).
    {
      path: 'courriels/retour-google',
      permission: 'communications.mailboxes_manage',
      component: lazyPage(() => import('./pages/GoogleReturnPage'), 'GoogleReturnPage'),
    },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.communicationsAuditLabels),
  settingsSections: [
    {
      id: 'gmail',
      path: 'courriels-gmail',
      labelKey: 'modules.communications.settings.gmail.title',
      icon: Mail,
      permission: 'communications.mailboxes_manage',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/GmailSettingsPage'), 'GmailSettingsPage'),
    },
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
