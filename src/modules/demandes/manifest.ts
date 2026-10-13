import type { ModuleManifest } from '@/core/modules/types'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/**
 * Module Demandes (plan §10): the counselors' requests — intake, discovery call, proposal, first
 * appointment — and the waiting list (roadmap §2.3 bis). D1 is the schema and the RPCs; the inbox
 * and the record come with D2, the waiting list's screens with D3. Depends on Clients (the
 * person's file, the participants) and Professionnels (the match, the catalogues).
 */
export const demandesManifest: ModuleManifest = {
  key: 'demandes',
  labelKey: 'modules.demandes.name',
  dependsOn: ['clients', 'professionals'],
  nav: [],
  routes: [],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.demandesAuditLabels),
  settingsSections: [],
}
