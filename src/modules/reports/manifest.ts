import { CalendarX2, ChartColumn, ChartLine, FileCheck2, HandCoins, ShieldCheck } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/** « Demandes » reads Demandes' facts: listed only while Demandes is enabled (the RPC refuses otherwise). */
const demandesEnabled = (access: Access) => access.modules.includes('demandes')

/**
 * Module Rapports (plan §12). RP1: « Revenus » (by invoice, by service, by payment; reports.finance)
 * in the Facturation section of the menu, and « Annulations et absences » with « Clients à
 * relancer » (reports.view) in Suivi; « Consentements » (reports.view, Clients C5b) in Suivi. It has no table: it reads what
 * Facturation and Rendez-vous publish. Depends on Facturation and Rendez-vous. « Demandes » (Demandes D6, reports.view) in
 * the Accueil des clients section, while Demandes is enabled. RP2: « Rapport IVAC » (reports.finance) and « Rapport de
 * paie » (reports.payroll) in Facturation.
 */
export const reportsManifest: ModuleManifest = {
  key: 'reports',
  labelKey: 'modules.reports.name',
  dependsOn: ['billing', 'appointments'],
  nav: [
    { path: '/rapports/revenus', labelKey: 'modules.reports.revenue.nav', icon: ChartColumn, permission: 'reports.finance', group: 'billing', order: 20 },
    { path: '/rapports/ivac', labelKey: 'modules.reports.ivac.nav', icon: ShieldCheck, permission: 'reports.finance', group: 'billing', order: 21 },
    { path: '/rapports/paie', labelKey: 'modules.reports.payouts.nav', icon: HandCoins, permission: 'reports.payroll', group: 'billing', order: 31 },
    { path: '/rapports/annulations', labelKey: 'modules.reports.cancellations.nav', icon: CalendarX2, permission: 'reports.view', group: 'followUp', order: 17 },
    { path: '/rapports/consentements', labelKey: 'modules.reports.consents.nav', icon: FileCheck2, permission: 'reports.view', group: 'followUp', order: 18 },
    {
      path: '/rapports/demandes',
      labelKey: 'modules.reports.demandes.nav',
      icon: ChartLine,
      permission: 'reports.view',
      shownWhen: demandesEnabled,
      group: 'intake',
      order: 14,
    },
  ],
  routes: [
    { path: 'rapports/revenus', permission: 'reports.finance', component: lazyPage(() => import('./pages/RevenuePage'), 'RevenuePage') },
    { path: 'rapports/annulations', permission: 'reports.view', component: lazyPage(() => import('./pages/CancellationsPage'), 'CancellationsPage') },
    { path: 'rapports/consentements', permission: 'reports.view', component: lazyPage(() => import('./pages/ConsentsReportPage'), 'ConsentsReportPage') },
    { path: 'rapports/demandes', permission: 'reports.view', component: lazyPage(() => import('./pages/DemandesReportPage'), 'DemandesReportPage') },
    { path: 'rapports/ivac', permission: 'reports.finance', component: lazyPage(() => import('./pages/IvacReportPage'), 'IvacReportPage') },
    { path: 'rapports/paie', permission: 'reports.payroll', component: lazyPage(() => import('./pages/PayoutsReportPage'), 'PayoutsReportPage') },
  ],
  settingsSections: [],
}
