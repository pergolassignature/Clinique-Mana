import { Inbox, PhoneCall } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/**
 * `/appel-decouverte?clinique=<org>` and `/appel-decouverte/annuler#t=…` (D3c): the public
 * discovery-call booking page that replaces Calendly, and its cancel link. Public, outside
 * RequireAuth; the app registers them with the other public pages (`src/app/public-pages.ts`).
 */
export const bookingPublicPage = lazyPage(() => import('./pages/public/BookingPage'), 'BookingPage')
export const bookingCancelPublicPage = lazyPage(() => import('./pages/public/BookingCancelPage'), 'BookingCancelPage')

/**
 * Module Demandes (plan §10): the counselors' requests — intake, discovery call, proposal, first
 * appointment — and the waiting list (roadmap §2.3 bis). D1 is the schema and the RPCs; D2 the
 * inbox (« Demandes ») and the record (Accueil, Participants, Suivi, Historique), live between
 * counselors; the waiting list's screens come with D3; D3c the public booking page and
 * Paramètres → Appels découverte. Depends on Clients (the person's file, the participants) and
 * Professionnels (the match, the catalogues).
 */
export const demandesManifest: ModuleManifest = {
  key: 'demandes',
  labelKey: 'modules.demandes.name',
  dependsOn: ['clients', 'professionals'],
  nav: [{ path: '/demandes', labelKey: 'modules.demandes.name', icon: Inbox, permission: 'demandes.view', order: 12 }],
  routes: [
    { path: 'demandes', permission: 'demandes.view', component: lazyPage(() => import('./pages/DemandesInboxPage'), 'DemandesInboxPage') },
    // The tab is a URL segment: accueil, participants, suivi, historique (RECORD_TABS).
    {
      path: 'demandes/:id/:onglet?',
      permission: 'demandes.view',
      component: lazyPage(() => import('./pages/DemandeRecordPage'), 'DemandeRecordPage'),
    },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.demandesAuditLabels),
  settingsSections: [
    {
      id: 'booking',
      path: 'appels-decouverte',
      labelKey: 'modules.demandes.booking.settings.title',
      icon: PhoneCall,
      permission: 'demandes.view',
      editPermission: 'demandes.manage',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/BookingSettingsPage'), 'BookingSettingsPage'),
    },
  ],
}
