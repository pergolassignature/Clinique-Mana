import { CalendarX2, ChartColumn, FileCheck2 } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/**
 * Module Rapports (plan §12). RP1: « Revenus » (by invoice, by service, by payment; reports.finance)
 * in the Facturation section of the menu, and « Annulations et absences » with « Clients à
 * relancer » (reports.view) in Suivi; « Consentements » (reports.view, Clients C5b) in Suivi. It has no table: it reads what Facturation and Rendez-vous
 * publish. Depends on Facturation and Rendez-vous.
 */
export const reportsManifest: ModuleManifest = {
  key: 'reports',
  labelKey: 'modules.reports.name',
  dependsOn: ['billing', 'appointments'],
  nav: [
    { path: '/rapports/revenus', labelKey: 'modules.reports.revenue.nav', icon: ChartColumn, permission: 'reports.finance', group: 'billing', order: 20 },
    { path: '/rapports/annulations', labelKey: 'modules.reports.cancellations.nav', icon: CalendarX2, permission: 'reports.view', group: 'followUp', order: 17 },
    { path: '/rapports/consentements', labelKey: 'modules.reports.consents.nav', icon: FileCheck2, permission: 'reports.view', group: 'followUp', order: 18 },
  ],
  routes: [
    { path: 'rapports/revenus', permission: 'reports.finance', component: lazyPage(() => import('./pages/RevenuePage'), 'RevenuePage') },
    { path: 'rapports/annulations', permission: 'reports.view', component: lazyPage(() => import('./pages/CancellationsPage'), 'CancellationsPage') },
    { path: 'rapports/consentements', permission: 'reports.view', component: lazyPage(() => import('./pages/ConsentsReportPage'), 'ConsentsReportPage') },
  ],
  settingsSections: [],
}
