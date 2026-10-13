import { Inbox, ListOrdered, PhoneCall, PhoneOutgoing } from 'lucide-react'
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
/** `/liste-attente/reponse#t=…` (D3): the answer to the « still on the waiting list? » email. Public. */
export const waitlistAnswerPublicPage = lazyPage(() => import('./pages/public/WaitlistAnswerPage'), 'WaitlistAnswerPage')

/**
 * Module Demandes (plan §10): the counselors' requests — intake, discovery call, proposal, first
 * appointment — and the waiting list (roadmap §2.3 bis). D1 is the schema and the RPCs; D2 the
 * inbox (« Demandes ») and the record (Accueil, Participants, Suivi, Historique), live between
 * counselors; D3b « Appels découverte » (the counselors' day of calls); D3 the waiting list (« Liste d'attente », its follow-up, Paramètres → Liste
 * d'attente); D3c the public booking page and Paramètres → Appels découverte. Depends on Clients (the person's file, the participants) and
 * Professionnels (the match, the catalogues).
 */
export const demandesManifest: ModuleManifest = {
  key: 'demandes',
  labelKey: 'modules.demandes.name',
  dependsOn: ['clients', 'professionals'],
  nav: [
    { path: '/demandes', labelKey: 'modules.demandes.name', icon: Inbox, permission: 'demandes.view', order: 12 },
    { path: '/demandes/appels', labelKey: 'modules.demandes.calls.nav', icon: PhoneOutgoing, permission: 'demandes.view', order: 12.5 },
    { path: '/liste-attente', labelKey: 'modules.demandes.waitlist.name', icon: ListOrdered, permission: 'demandes.view', order: 13 },
  ],
  routes: [
    { path: 'demandes', permission: 'demandes.view', component: lazyPage(() => import('./pages/DemandesInboxPage'), 'DemandesInboxPage') },
    // Before the record's route: « appels » is not a request's id.
    { path: 'demandes/appels', permission: 'demandes.view', component: lazyPage(() => import('./pages/DiscoveryCallsPage'), 'DiscoveryCallsPage') },
    // The tab is a URL segment: accueil, participants, suivi, historique (RECORD_TABS).
    {
      path: 'demandes/:id/:onglet?',
      permission: 'demandes.view',
      component: lazyPage(() => import('./pages/DemandeRecordPage'), 'DemandeRecordPage'),
    },
    { path: 'liste-attente', permission: 'demandes.view', component: lazyPage(() => import('./pages/WaitlistPage'), 'WaitlistPage') },
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
    {
      id: 'waitlist',
      path: 'liste-attente',
      labelKey: 'modules.demandes.waitlist.settings.title',
      icon: ListOrdered,
      permission: 'demandes.view',
      editPermission: 'demandes.waitlist',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/WaitlistSettingsPage'), 'WaitlistSettingsPage'),
    },
  ],
}
