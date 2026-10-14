import { ArrowLeftRight, BookUser, Building2, CreditCard, HandCoins, Landmark, ReceiptText, Wallet } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/** « Ma paie »: an account linked to a professional file. */
const hasProfessionalFile = (access: Access) => access.has_professional_file

/** `/carte#t=…` (FS): « Enregistrer ma carte », from the card email. Public. */
export const cardSetupPublicPage = lazyPage(() => import('./pages/public/StripeLinkPage'), 'CardSetupPage')
/** `/payer#t=…` (FS-4): « Payer en ligne », from an invoice email. Public. */
export const payPublicPage = lazyPage(() => import('./pages/public/StripeLinkPage'), 'PayPage')

/**
 * Module Facturation (plan §8). F1: the invoices of a dossier billed to its payer (« Facturé à »),
 * their lines priced by Services et tarifs, the numbering `AAAA-N`, the taxes per line and the
 * credit notes; « Factures », an invoice's page, the client's panel in « Visites et paiements »
 * and Paramètres → Facturation (the numbering). F2: the morning queue, receipts and statements;
 * F3: dunning, the balance rule, cancellation fees. FQ (QuickBooks, lane B): the connection, the
 * accounts map and the customers' matching. FS (online payments): Stripe cards on file and the
 * next-day charge, « Payer en ligne », « Virements Interac », Paramètres → Paiements en ligne, the
 * public pages `/carte` and `/payer`. FPay (payroll): « Paie » for the administration
 * (`billing.payroll`), « Ma paie » for the professional (`billing.self`), Paramètres → Paie. FP
 * (third-party payers): « Payeurs tiers » (the IVAC and PAE invoices, « Facturer les PAE »), a
 * dossier's payers in its panel, Paramètres → Payeurs tiers.
 * Depends on Clients, Services et tarifs, Professionnels and Rendez-vous.
 */
export const billingManifest: ModuleManifest = {
  key: 'billing',
  labelKey: 'modules.billing.name',
  dependsOn: ['clients', 'services', 'professionals', 'appointments'],
  nav: [
    { path: '/facturation', labelKey: 'modules.billing.name', icon: ReceiptText, permission: 'billing.view', group: 'billing', order: 13 },
    { path: '/facturation/virements', labelKey: 'modules.billing.interac.nav', icon: ArrowLeftRight, permission: 'billing.view', group: 'billing', order: 14 },
    // FP: « Payeurs tiers », the IVAC and PAE invoices (the April closing notice links here).
    { path: '/facturation/payeurs', labelKey: 'modules.billing.payers.nav', icon: Building2, permission: 'billing.view', group: 'billing', order: 15 },
    { path: '/facturation/paie', labelKey: 'modules.billing.payroll.nav.payroll', icon: HandCoins, permission: 'billing.payroll', group: 'billing', order: 30 },
    {
      path: '/ma-paie',
      labelKey: 'modules.billing.payroll.nav.myPay',
      icon: Wallet,
      permission: 'billing.self',
      shownWhen: hasProfessionalFile,
      group: 'main',
      order: 8,
    },
  ],
  // Accueil « Facturation à traiter » (L29): the morning queue, the unpaid, Interac to match, payers to invoice.
  homeCards: [
    { id: 'billing-queue', permission: 'billing.view', component: lazyPage(() => import('./components/BillingHomeCard'), 'BillingHomeCard') },
  ],
  routes: [
    { path: 'facturation', permission: 'billing.view', component: lazyPage(() => import('./pages/InvoicesPage'), 'InvoicesPage') },
    { path: 'facturation/factures/:id', permission: 'billing.view', component: lazyPage(() => import('./pages/InvoicePage'), 'InvoicePage') },
    { path: 'facturation/virements', permission: 'billing.view', component: lazyPage(() => import('./pages/InteracPage'), 'InteracPage') },
    { path: 'facturation/payeurs', permission: 'billing.view', component: lazyPage(() => import('./pages/PayersPage'), 'PayersPage') },
    { path: 'facturation/paie', permission: 'billing.payroll', component: lazyPage(() => import('./pages/PayrollPage'), 'PayrollPage') },
    { path: 'ma-paie', permission: 'billing.self', component: lazyPage(() => import('./pages/MyPayPage'), 'MyPayPage') },
    { path: 'ma-paie/:periodId', permission: 'billing.self', component: lazyPage(() => import('./pages/MyPayPage'), 'MyPayPage') },
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
    {
      // Paramètres → Payeurs tiers (FP): IVAC's rate (billing.settings), the organisations (billing.manage).
      id: 'payers',
      path: 'payeurs-tiers',
      labelKey: 'modules.billing.payers.settings.title',
      icon: Building2,
      permission: ['billing.manage', 'billing.settings'],
      editPermission: 'billing.manage',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/PayersSettingsPage'), 'PayersSettingsPage'),
    },
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
    {
      // Paramètres → Paiements en ligne (FS): the Stripe keys, the webhook, the next-day charge job.
      id: 'online_payments',
      path: 'paiements-en-ligne',
      labelKey: 'modules.billing.stripe.settings.title',
      icon: CreditCard,
      permission: 'billing.settings',
      editPermission: 'billing.settings',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/OnlinePaymentsSettingsPage'), 'OnlinePaymentsSettingsPage'),
    },
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
  // Clients' « Visites et paiements »: the dossier's invoices and what is left to invoice.
  slots: {
    'client.visits': [
      { id: 'billing.invoices', permissions: ['billing.view'], component: lazyPage(() => import('./pages/ClientBillingPanel'), 'ClientBillingPanel') },
      // FS: the dossier's payers' card on file.
      { id: 'billing.card', permissions: ['billing.view'], component: lazyPage(() => import('./pages/ClientCardPanel'), 'ClientCardPanel') },
    ],
    // « Mon agenda »: the professional's cancellation fees to decide (F3, R-59).
    'agenda.mine': [{ id: 'billing.fees', permissions: ['billing.self'], component: lazyPage(() => import('./pages/FollowUp'), 'MyFeesPanel') }],
    // The appointment sheet's « Facturation » tab (L10): its invoice, price and fee.
    'appointment.sheet': [
      { id: 'billing.appointment', permissions: ['billing.view'], component: lazyPage(() => import('./pages/AppointmentBillingPanel'), 'AppointmentBillingPanel') },
    ],
  },
}
