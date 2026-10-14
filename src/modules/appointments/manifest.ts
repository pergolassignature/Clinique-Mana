import { CalendarClock, CalendarCog, CalendarDays, CalendarRange, Video } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/** The professional's space (« Mon agenda », « Vidéoconférence »): an account linked to a professional file. */
const hasProfessionalFile = (access: Access) => access.has_professional_file

/** `/rendez-vous/confirmer#t=…` (R4): « Confirmer ma présence », from a confirmation, reminder or change email. Public. */
export const confirmAppointmentPublicPage = lazyPage(() => import('./pages/public/ConfirmAppointmentPage'), 'ConfirmAppointmentPage')

/**
 * Module Rendez-vous (plan §7): the clinic's agenda. R1: the schema and the booking rules in the
 * database; R2: « Agenda » for the staff (Jour, Semaine, Prochains jours, Mois; all
 * professionals, a service's or one; the availability mode). R3: series, personal appointments,
 * completion; R4: the clients' messages; R5: « Mon agenda » for a professional and her clients'
 * visits in Clients' record (slot `client.visits`). RZ adds the video links: each professional's
 * Zoom or fixed link (« Vidéoconférence » in her space) and the staff's view of who is ready
 * (Paramètres → Vidéoconférence). R6 adds a professional's opt-in Google busy times (« Agenda
 * Google »: « Occupé » in the agenda, never offered as open slots). Depends on Clients (the files), Services et tarifs (durations,
 * « pause après », who offers what) and Professionnels.
 */
export const appointmentsManifest: ModuleManifest = {
  key: 'appointments',
  labelKey: 'modules.appointments.name',
  dependsOn: ['clients', 'services', 'professionals'],
  nav: [
    { path: '/agenda', labelKey: 'modules.appointments.agenda.title', icon: CalendarDays, permission: 'appointments.view', group: 'followUp', order: 12 },
    // The professional's own agenda (R5).
    {
      path: '/mon-agenda',
      labelKey: 'modules.appointments.mine.title',
      icon: CalendarRange,
      permission: 'appointments.self',
      shownWhen: hasProfessionalFile,
      group: 'main',
      order: 6,
    },
    // The professional's video link (RZ).
    {
      path: '/mon-agenda/videoconference',
      labelKey: 'modules.appointments.video.nav',
      icon: Video,
      permission: 'appointments.self',
      shownWhen: hasProfessionalFile,
      group: 'main',
      order: 7,
    },
    // The professional's opt-in Google busy times (R6).
    {
      path: '/mon-agenda/agenda-google',
      labelKey: 'modules.appointments.calendar.nav',
      icon: CalendarClock,
      permission: 'appointments.self',
      shownWhen: hasProfessionalFile,
      group: 'main',
      order: 8,
    },
  ],
  // Accueil « Rendez-vous à surveiller » (L29): today's appointments not confirmed yet, the coming ones without a reminder.
  homeCards: [
    { id: 'appointments-watch', permission: 'appointments.view', component: lazyPage(() => import('./components/AppointmentsHomeCard'), 'AppointmentsHomeCard') },
  ],
  routes: [
    { path: 'agenda', permission: 'appointments.view', component: lazyPage(() => import('./pages/AgendaPage'), 'AgendaPage') },
    { path: 'mon-agenda', permission: 'appointments.self', component: lazyPage(() => import('./pages/AgendaPage'), 'MyAgendaPage') },
    // Also where Zoom sends the browser back after « Connecter mon Zoom »: fixed, the functions
    // build the same address from APP_URL (`_shared/zoom/env.ts` RETURN_PATH).
    {
      path: 'mon-agenda/videoconference',
      permission: 'appointments.self',
      component: lazyPage(() => import('./pages/MyVideoPage'), 'MyVideoPage'),
    },
    // R6: also where Google sends the browser back after « Connecter mon agenda Google »
    // (`_shared/google-calendar/env.ts` RETURN_PATH).
    {
      path: 'mon-agenda/agenda-google',
      permission: 'appointments.self',
      component: lazyPage(() => import('./pages/MyGoogleCalendarPage'), 'MyGoogleCalendarPage'),
    },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.appointmentsAuditLabels),
  settingsSections: [
    {
      // Paramètres → Agenda (AP-31): business days and hours, reminders, the late notice's count.
      id: 'agenda',
      path: 'agenda',
      labelKey: 'modules.appointments.settings.title',
      icon: CalendarCog,
      permission: 'appointments.view',
      editPermission: 'appointments.settings',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/AgendaSettingsPage'), 'AgendaSettingsPage'),
    },
    {
      // Paramètres → Vidéoconférence (RZ): who is ready for video appointments, the Zoom app.
      id: 'video',
      path: 'videoconference',
      labelKey: 'modules.appointments.video.settings.title',
      icon: Video,
      permission: 'appointments.view',
      editPermission: 'appointments.manage',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/VideoSettingsPage'), 'VideoSettingsPage'),
    },
  ],
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
