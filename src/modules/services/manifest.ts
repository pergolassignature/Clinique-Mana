import type { ModuleManifest } from '@/core/modules/types'

// On the login page's entry path (ALL_MODULES): types and lazy loaders only. The settings
// section (S2) and its API, hooks and schemas load with its page.

/**
 * Services et tarifs (plan §5): one catalogue per clinic, coded like GOrendezvous, with the
 * duration, the taxes and the source of each price (the retention grids, a fixed amount, free,
 * or typed on the invoice). No menu entry of its own: a settings section (S2). Depends on
 * Professionnels (titles, retention grids).
 */
export const servicesManifest: ModuleManifest = {
  key: 'services',
  labelKey: 'modules.services.name',
  dependsOn: ['professionals'],
  routes: [],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.servicesAuditLabels),
  settingsSections: [],
}
