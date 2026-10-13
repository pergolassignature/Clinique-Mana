import { BookUser, Landmark } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/**
 * Module Facturation (plan §8). F1: the invoices of a dossier billed to its payer (« Facturé à »),
 * their lines priced by Services et tarifs, the numbering `AAAA-N`, the taxes per line and the
 * credit notes, all in the database; the screens come with F1's next part. F2: the morning queue,
 * receipts and statements; F3: dunning, the balance rule, cancellation fees. FQ (QuickBooks, lane
 * B) and FPay (payroll, lane C) add their sections and routes here. Depends on Clients, Services
 * et tarifs, Professionnels and Rendez-vous.
 */
export const billingManifest: ModuleManifest = {
  key: 'billing',
  labelKey: 'modules.billing.name',
  dependsOn: ['clients', 'services', 'professionals', 'appointments'],
  routes: [
    // FQ: where Intuit sends the browser back after « Connecter QuickBooks »: fixed, the functions
    // build the same address from APP_URL (`_shared/qbo/env.ts` RETURN_PATH).
    {
      path: 'facturation/retour-quickbooks',
      permission: 'billing.settings',
      component: lazyPage(() => import('./pages/QuickBooksReturnPage'), 'QuickBooksReturnPage'),
    },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.billingAuditLabels),
  settingsSections: [
    // FQ: the QuickBooks connection and its accounts map; the customers' matching report.
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
