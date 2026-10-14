import { Contact, FileCheck, UsersRound } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/** « Mes clients »: an account linked to a professional file (an admin holds clients.self without one). */
const hasProfessionalFile = (access: Access) => access.has_professional_file

/**
 * `/consentement#t=…` (C5a): where a consent request email lands. Public, outside RequireAuth;
 * the app registers it with the other public pages (`src/app/public-pages.ts`).
 */
export const consentPublicPage = lazyPage(() => import('./pages/public/ConsentPublicPage'), 'ConsentPublicPage')

/**
 * Module Clients (plan §6): the clinic's client files, their relations and rights, insurance,
 * payers (IVAC, PAE), tags, the professionals who may see them; duplicates, merge and Loi 25.
 * Screens: « Clients » (the list, « Nouveau client », the record, C3) for the staff, « Mes
 * clients » for a professional; the consents (C5a: « Consentements à obtenir », Paramètres →
 * Consentements, the public page). Depends on Professionnels (primary professional, who may see
 * a client).
 */
export const clientsManifest: ModuleManifest = {
  key: 'clients',
  labelKey: 'modules.clients.name',
  dependsOn: ['professionals'],
  nav: [
    { path: '/clients', labelKey: 'modules.clients.name', icon: UsersRound, permission: 'clients.view', group: 'followUp', order: 15 },
    { path: '/clients/consentements', labelKey: 'modules.clients.consents.nav', icon: FileCheck, permission: 'clients.view', group: 'followUp', order: 16 },
    { path: '/mes-clients', labelKey: 'modules.clients.mine.title', icon: Contact, permission: 'clients.self', shownWhen: hasProfessionalFile, group: 'main', order: 7 },
  ],
  // Accueil « Consentements à obtenir » (L29): the signature requests waiting, the late ones first.
  homeCards: [
    { id: 'clients-consents', permission: 'clients.view', component: lazyPage(() => import('./components/ConsentsHomeCard'), 'ConsentsHomeCard') },
  ],
  routes: [
    { path: 'clients', permission: 'clients.view', component: lazyPage(() => import('./pages/ClientsListPage'), 'ClientsListPage') },
    {
      path: 'clients/consentements',
      permission: 'clients.view',
      component: lazyPage(() => import('./pages/ConsentsToObtainPage'), 'ConsentsToObtainPage'),
    },
    // FP-9: the IVAC and PAE payers to complete (the import's tags); linked from « Payeurs tiers ».
    {
      path: 'clients/payeurs-a-completer',
      permission: 'clients.view',
      component: lazyPage(() => import('./pages/PayersToCompletePage'), 'PayersToCompletePage'),
    },
    // The tab is a URL segment: apercu, informations… (RECORD_TABS)
    { path: 'clients/:id/:onglet?', permission: 'clients.view', component: lazyPage(() => import('./pages/ClientRecordPage'), 'ClientRecordPage') },
    { path: 'mes-clients', permission: 'clients.self', component: lazyPage(() => import('./pages/MyClientsPage'), 'MyClientsPage') },
  ],
  // The global search (⌘K, C4): name, email, number, phone. Staff who read the files only: a
  // professional (clients.self) has « Mes clients », never a record.
  search: [
    {
      id: 'clients',
      labelKey: 'modules.clients.name',
      icon: UsersRound,
      permission: 'clients.view',
      minChars: 2,
      load: () => import('./search').then((m) => m.searchClientFiles),
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
