import { HandCoins, Wallet } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/** « Ma paie »: an account linked to a professional file. */
const hasProfessionalFile = (access: Access) => access.has_professional_file

/**
 * Module Facturation (plan §8). F1: the invoices of a dossier billed to its payer (« Facturé à »),
 * their lines priced by Services et tarifs, the numbering `AAAA-N`, the taxes per line and the
 * credit notes, all in the database; the screens come with F1's next part. F2: the morning queue,
 * receipts and statements; F3: dunning, the balance rule, cancellation fees. FQ (QuickBooks, lane
 * B) adds its sections here. FPay (payroll): « Paie » for the administration (`billing.payroll`),
 * « Ma paie » for the professional (`billing.self`), Paramètres → Paie. Depends on Clients,
 * Services et tarifs, Professionnels and Rendez-vous.
 */
export const billingManifest: ModuleManifest = {
  key: 'billing',
  labelKey: 'modules.billing.name',
  dependsOn: ['clients', 'services', 'professionals', 'appointments'],
  nav: [
    { path: '/facturation/paie', labelKey: 'modules.billing.payroll.nav.payroll', icon: HandCoins, permission: 'billing.payroll', order: 30 },
    {
      path: '/ma-paie',
      labelKey: 'modules.billing.payroll.nav.myPay',
      icon: Wallet,
      permission: 'billing.self',
      shownWhen: hasProfessionalFile,
      order: 8,
    },
  ],
  routes: [
    { path: 'facturation/paie', permission: 'billing.payroll', component: lazyPage(() => import('./pages/PayrollPage'), 'PayrollPage') },
    { path: 'ma-paie', permission: 'billing.self', component: lazyPage(() => import('./pages/MyPayPage'), 'MyPayPage') },
    { path: 'ma-paie/:periodId', permission: 'billing.self', component: lazyPage(() => import('./pages/MyPayPage'), 'MyPayPage') },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.billingAuditLabels),
  settingsSections: [
    {
      // Paramètres → Paie (FPay): each service's payroll rule, the job.
      id: 'payroll',
      path: 'paie',
      labelKey: 'modules.billing.payroll.settings.title',
      icon: HandCoins,
      permission: ['billing.settings', 'billing.payroll'],
      editPermission: 'billing.settings',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/PayrollSettingsPage'), 'PayrollSettingsPage'),
    },
  ],
}
