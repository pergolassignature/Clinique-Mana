import { ReceiptText } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/**
 * Module Facturation (plan §8). F1: the invoices of a dossier billed to its payer (« Facturé à »),
 * their lines priced by Services et tarifs, the numbering `AAAA-N`, the taxes per line and the
 * credit notes; « Factures », an invoice's page, the client's panel in « Visites et paiements »
 * and Paramètres → Facturation (the numbering). F2: the morning queue, receipts and statements;
 * F3: dunning, the balance rule, cancellation fees. FQ (QuickBooks, lane B) and FPay (payroll,
 * lane C) add their sections and routes here. Depends on Clients, Services et tarifs,
 * Professionnels and Rendez-vous.
 */
export const billingManifest: ModuleManifest = {
  key: 'billing',
  labelKey: 'modules.billing.name',
  dependsOn: ['clients', 'services', 'professionals', 'appointments'],
  nav: [{ path: '/facturation', labelKey: 'modules.billing.name', icon: ReceiptText, permission: 'billing.view', order: 13 }],
  routes: [
    { path: 'facturation', permission: 'billing.view', component: lazyPage(() => import('./pages/InvoicesPage'), 'InvoicesPage') },
    { path: 'facturation/factures/:id', permission: 'billing.view', component: lazyPage(() => import('./pages/InvoicePage'), 'InvoicePage') },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.billingAuditLabels),
  settingsSections: [
    {
      // Paramètres → Facturation: the numbering (F1); QuickBooks (FQ) adds its own sections.
      id: 'billing',
      path: 'facturation',
      labelKey: 'modules.billing.settings.title',
      icon: ReceiptText,
      permission: 'billing.view',
      editPermission: 'billing.settings',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/BillingSettingsPage'), 'BillingSettingsPage'),
    },
  ],
  // Clients' « Visites et paiements »: the dossier's invoices and what is left to invoice.
  slots: {
    'client.visits': [
      { id: 'billing.invoices', permissions: ['billing.view'], component: lazyPage(() => import('./pages/ClientBillingPanel'), 'ClientBillingPanel') },
    ],
  },
}
