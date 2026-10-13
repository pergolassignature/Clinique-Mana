import type { ModuleManifest } from '@/core/modules/types'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

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
  routes: [],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.billingAuditLabels),
  settingsSections: [],
}
