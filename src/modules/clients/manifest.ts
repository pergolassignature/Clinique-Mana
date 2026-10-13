import { FileCheck } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/**
 * `/consentement#t=…` (C5a): where a consent request email lands. Public, outside RequireAuth;
 * the app registers it with the other public pages (`src/app/public-pages.ts`).
 */
export const consentPublicPage = lazyPage(() => import('./pages/public/ConsentPublicPage'), 'ConsentPublicPage')

/**
 * Module Clients (plan §6): the clinic's client files, their relations and rights, insurance,
 * payers (IVAC, PAE), tags, the professionals who may see them; duplicates, merge and Loi 25.
 * C1 is the schema; the list, the record and « Mes clients » come with C3; C5a the consents
 * (« Consentements à obtenir », Paramètres → Consentements, the public page). Depends on
 * Professionnels (primary professional, who may see a client).
 */
export const clientsManifest: ModuleManifest = {
  key: 'clients',
  labelKey: 'modules.clients.name',
  dependsOn: ['professionals'],
  nav: [{ path: '/clients/consentements', labelKey: 'modules.clients.consents.nav', icon: FileCheck, permission: 'clients.view', order: 16 }],
  routes: [
    {
      path: 'clients/consentements',
      permission: 'clients.view',
      component: lazyPage(() => import('./pages/ConsentsToObtainPage'), 'ConsentsToObtainPage'),
    },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.clientsAuditLabels),
  settingsSections: [
    {
      id: 'consents',
      path: 'consentements',
      labelKey: 'modules.clients.consents.settings.title',
      icon: FileCheck,
      permission: 'clients.view',
      editPermission: 'clients.manage',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/ConsentsSettingsPage'), 'ConsentsSettingsPage'),
    },
  ],
}
