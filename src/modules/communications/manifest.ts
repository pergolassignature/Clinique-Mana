import { Mail } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/**
 * Module Communications (plan §11): the clinic's Gmail mailboxes (`info@`, `administration@`),
 * the inbox « Courriels » (CM2), the composer (CM3), « Rédiger avec l'IA » (CM4) and the SMS
 * (batch SM). Depends on core only; Clients is optional (linking threads to records).
 */
export const communicationsManifest: ModuleManifest = {
  key: 'communications',
  labelKey: 'modules.communications.name',
  dependsOn: [],
  nav: [],
  routes: [
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
  ],
}
