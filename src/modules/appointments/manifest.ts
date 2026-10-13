import { CalendarDays, CalendarRange } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/** « Mon agenda »: an account linked to a professional file (admins hold appointments.self without one). */
const hasProfessionalFile = (access: Access) => access.has_professional_file

/** `/rendez-vous/confirmer#t=…` (R4): « Confirmer ma présence », from a confirmation, reminder or change email. Public. */
export const confirmAppointmentPublicPage = lazyPage(() => import('./pages/public/ConfirmAppointmentPage'), 'ConfirmAppointmentPage')

/**
 * Module Rendez-vous (plan §7): the clinic's agenda. R1: the schema and the booking rules in the
 * database; R2: « Agenda » for the staff (Jour, Semaine, Prochains jours, Mois; all
 * professionals, a service's or one; the availability mode). R3: series, personal appointments,
 * completion; R4: the clients' messages; R5: « Mon agenda » for a professional and her client's
 * visits in Clients' record (slot `client.visits`). Depends on Clients (the files), Services et tarifs (durations, « pause après »,
 * who offers what) and Professionnels.
 */
export const appointmentsManifest: ModuleManifest = {
  key: 'appointments',
  labelKey: 'modules.appointments.name',
  dependsOn: ['clients', 'services', 'professionals'],
  nav: [
    { path: '/agenda', labelKey: 'modules.appointments.agenda.title', icon: CalendarDays, permission: 'appointments.view', order: 12 },
    // The professional's own agenda (R5).
    {
      path: '/mon-agenda',
      labelKey: 'modules.appointments.mine.title',
      icon: CalendarRange,
      permission: 'appointments.self',
      shownWhen: hasProfessionalFile,
      order: 6,
    },
  ],
  routes: [
    { path: 'agenda', permission: 'appointments.view', component: lazyPage(() => import('./pages/AgendaPage'), 'AgendaPage') },
    { path: 'mon-agenda', permission: 'appointments.self', component: lazyPage(() => import('./pages/AgendaPage'), 'MyAgendaPage') },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.appointmentsAuditLabels),
  settingsSections: [],
  // Clients' « Visites et paiements » (R5): the client's appointments.
  slots: {
    'client.visits': [
      {
        id: 'appointments.visits',
        permissions: ['appointments.view', 'appointments.self'],
        component: lazyPage(() => import('./pages/ClientVisitsPanel'), 'ClientVisitsPanel'),
      },
    ],
  },
}
