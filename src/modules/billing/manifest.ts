import { BookUser, Landmark } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/**
 * Module Facturation (plan §8). FQ part 1 starts it as a skeleton (FQ-1): the QuickBooks
 * connection, its accounts map and the customers' mapping report, in Paramètres. F1 (lane A) adds
 * the invoices, the payers, their routes and their own permissions on top.
 */
export const billingManifest: ModuleManifest = {
  key: 'billing',
  labelKey: 'modules.billing.name',
  dependsOn: ['clients', 'services', 'professionals'],
  nav: [],
  routes: [
    // Where Intuit sends the browser back after « Connecter QuickBooks »: fixed, the functions build
    // the same address from APP_URL (`_shared/qbo/env.ts` RETURN_PATH).
    {
      path: 'facturation/retour-quickbooks',
      permission: 'billing.settings',
      component: lazyPage(() => import('./pages/QuickBooksReturnPage'), 'QuickBooksReturnPage'),
    },
  ],
  audit: () => import('./lib/audit-labels').then((m) => m.billingAuditLabels),
  settingsSections: [
    {
      id: 'quickbooks',
      path: 'quickbooks',
      labelKey: 'modules.billing.qbo.title',
      icon: Landmark,
      permission: 'billing.settings',
      editPermission: 'billing.settings',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/QuickBooksSettingsPage'), 'QuickBooksSettingsPage'),
    },
    {
      id: 'quickbooks_customers',
      path: 'quickbooks-clients',
      labelKey: 'modules.billing.qbo.customers.title',
      icon: BookUser,
      permission: 'billing.settings',
      editPermission: 'billing.settings',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/QuickBooksCustomersPage'), 'QuickBooksCustomersPage'),
    },
  ],
}
