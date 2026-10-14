import { CalendarX2, ChartColumn, ChartLine, FileCheck2, HandCoins, ShieldCheck } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/** « Demandes » reads Demandes' facts: listed only while Demandes is enabled (the RPC refuses otherwise). */
const demandesEnabled = (access: Access) => access.modules.includes('demandes')

/**
 * « Indicateurs des demandes » (R-81): its own permission (the conseillères by default), or
 * reports.view (every activity report) as before; `report_demandes` accepts either.
 */
const DEMANDES_INDICATORS = ['reports.demandes_indicators', 'reports.view'] as const

/**
 * Module Rapports (plan §12). RP1: « Revenus » (by invoice, by service, by payment; reports.finance),
 * « Annulations et absences » with « Clients à relancer » (reports.view); « Consentements des
 * clients » (reports.view, Clients C5b); « Indicateurs des demandes » (Demandes D6,
 * reports.demandes_indicators or reports.view (R-81), while Demandes is enabled); RP2: « IVAC » (reports.finance) and « Paie des professionnels »
 * (reports.payroll). Every report in the menu's « Rapports » section (NAV-2). It has no table: it
 * reads what Facturation, Rendez-vous, Clients and Demandes publish. Depends on Facturation and
 * Rendez-vous.
 */
export const reportsManifest: ModuleManifest = {
  key: 'reports',
  labelKey: 'modules.reports.name',
  dependsOn: ['billing', 'appointments'],
  nav: [
    // NAV-2: one « Rapports » section, in this order.
    { path: '/rapports/revenus', labelKey: 'modules.reports.revenue.nav', icon: ChartColumn, permission: 'reports.finance', group: 'reports', order: 1 },
    { path: '/rapports/paie', labelKey: 'modules.reports.payouts.nav', icon: HandCoins, permission: 'reports.payroll', group: 'reports', order: 2 },
    { path: '/rapports/ivac', labelKey: 'modules.reports.ivac.nav', icon: ShieldCheck, permission: 'reports.finance', group: 'reports', order: 3 },
    { path: '/rapports/annulations', labelKey: 'modules.reports.cancellations.nav', icon: CalendarX2, permission: 'reports.view', group: 'reports', order: 4 },
    {
      path: '/rapports/demandes',
      labelKey: 'modules.reports.demandes.nav',
      icon: ChartLine,
      permission: DEMANDES_INDICATORS,
      shownWhen: demandesEnabled,
      group: 'reports',
      order: 5,
    },
    { path: '/rapports/consentements', labelKey: 'modules.reports.consents.nav', icon: FileCheck2, permission: 'reports.view', group: 'reports', order: 6 },
  ],
  routes: [
    { path: 'rapports/revenus', permission: 'reports.finance', component: lazyPage(() => import('./pages/RevenuePage'), 'RevenuePage') },
    { path: 'rapports/annulations', permission: 'reports.view', component: lazyPage(() => import('./pages/CancellationsPage'), 'CancellationsPage') },
    { path: 'rapports/consentements', permission: 'reports.view', component: lazyPage(() => import('./pages/ConsentsReportPage'), 'ConsentsReportPage') },
    { path: 'rapports/demandes', permission: DEMANDES_INDICATORS, component: lazyPage(() => import('./pages/DemandesReportPage'), 'DemandesReportPage') },
    { path: 'rapports/ivac', permission: 'reports.finance', component: lazyPage(() => import('./pages/IvacReportPage'), 'IvacReportPage') },
    { path: 'rapports/paie', permission: 'reports.payroll', component: lazyPage(() => import('./pages/PayoutsReportPage'), 'PayoutsReportPage') },
  ],
  settingsSections: [],
}
