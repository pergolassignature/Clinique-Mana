import { CalendarDays, Video } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/** « Vidéoconférence » in the professional's space: an account linked to a professional file. */
const hasProfessionalFile = (access: Access) => access.has_professional_file

/** `/rendez-vous/confirmer#t=…` (R4): « Confirmer ma présence », from a confirmation, reminder or change email. Public. */
export const confirmAppointmentPublicPage = lazyPage(() => import('./pages/public/ConfirmAppointmentPage'), 'ConfirmAppointmentPage')

/**
 * Module Rendez-vous (plan §7): the clinic's agenda. R1: the schema and the booking rules in the
 * database; R2: « Agenda » for the staff (Jour, Semaine, Prochains jours, Mois; all
 * professionals, a service's or one; the availability mode). « Mon agenda » for a professional
 * comes with R5. RZ adds the video links: each professional's Zoom or fixed link
 * (« Vidéoconférence » in her space) and the staff's view of who is ready (Paramètres →
 * Vidéoconférence). Depends on Clients (the files), Services et tarifs (durations, « pause
 * après », who offers what) and Professionnels.
 */
export const appointmentsManifest: ModuleManifest = {
  key: 'appointments',
  labelKey: 'modules.appointments.name',
  dependsOn: ['clients', 'services', 'professionals'],
  nav: [
    { path: '/agenda', labelKey: 'modules.appointments.agenda.title', icon: CalendarDays, permission: 'appointments.view', order: 12 },
    // The professional's video link (RZ), until « Mon agenda » (R5) holds it.
    {
      path: '/mon-agenda/videoconference',
      labelKey: 'modules.appointments.video.nav',
      icon: Video,
      permission: 'appointments.self',
      shownWhen: hasProfessionalFile,
      order: 7,
    },
  ],
  routes: [
    { path: 'agenda', permission: 'appointments.view', component: lazyPage(() => import('./pages/AgendaPage'), 'AgendaPage') },
    // Also where Zoom sends the browser back after « Connecter mon Zoom »: fixed, the functions
    // build the same address from APP_URL (`_shared/zoom/env.ts` RETURN_PATH).
    {
      path: 'mon-agenda/videoconference',
      permission: 'appointments.self',
      component: lazyPage(() => import('./pages/MyVideoPage'), 'MyVideoPage'),
    },
  ],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.appointmentsAuditLabels),
  settingsSections: [
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
}
