import type { ModuleManifest } from '@/core/modules/types'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/**
 * Module Clients (plan §6): the clinic's client files, their relations and rights, insurance,
 * payers (IVAC, PAE), tags, the professionals who may see them; duplicates, merge and Loi 25.
 * C1 is the schema; the list, the record and « Mes clients » come with C3. Depends on
 * Professionnels (primary professional, who may see a client).
 */
export const clientsManifest: ModuleManifest = {
  key: 'clients',
  labelKey: 'modules.clients.name',
  dependsOn: ['professionals'],
  nav: [],
  routes: [],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.clientsAuditLabels),
  settingsSections: [],
}
