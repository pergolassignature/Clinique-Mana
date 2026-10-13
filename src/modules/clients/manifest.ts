import { Contact, UsersRound } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/** « Mes clients »: an account linked to a professional file (an admin holds clients.self without one). */
const hasProfessionalFile = (access: Access) => access.has_professional_file

/**
 * Module Clients (plan §6): the clinic's client files, their relations and rights, insurance,
 * payers (IVAC, PAE), tags, the professionals who may see them; duplicates, merge and Loi 25.
 * Screens (C3): « Clients » (the list, « Nouveau client », the record) for the staff, « Mes
 * clients » for a professional. Depends on Professionnels (primary professional, who may see a
 * client).
 */
export const clientsManifest: ModuleManifest = {
  key: 'clients',
  labelKey: 'modules.clients.name',
  dependsOn: ['professionals'],
  nav: [
    { path: '/clients', labelKey: 'modules.clients.name', icon: UsersRound, permission: 'clients.view', order: 20 },
    { path: '/mes-clients', labelKey: 'modules.clients.mine.title', icon: Contact, permission: 'clients.self', shownWhen: hasProfessionalFile, order: 7 },
  ],
  routes: [
    { path: 'clients', permission: 'clients.view', component: lazyPage(() => import('./pages/ClientsListPage'), 'ClientsListPage') },
    // The tab is a URL segment: apercu, informations… (RECORD_TABS)
    { path: 'clients/:id/:onglet?', permission: 'clients.view', component: lazyPage(() => import('./pages/ClientRecordPage'), 'ClientRecordPage') },
    { path: 'mes-clients', permission: 'clients.self', component: lazyPage(() => import('./pages/MyClientsPage'), 'MyClientsPage') },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.clientsAuditLabels),
  settingsSections: [],
}
