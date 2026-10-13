import { CalendarDays } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/**
 * Module Rendez-vous (plan §7): the clinic's agenda. R1: the schema and the booking rules in the
 * database; R2: « Agenda » for the staff (Jour, Semaine, Prochains jours, Mois; all
 * professionals, a service's or one; the availability mode). « Mon agenda » for a professional
 * comes with R5. Depends on Clients (the files), Services et tarifs (durations, « pause après »,
 * who offers what) and Professionnels.
 */
/** `/rendez-vous/confirmer#t=…` (R4): « Confirmer ma présence », from a confirmation, reminder or change email. Public. */
export const confirmAppointmentPublicPage = lazyPage(() => import('./pages/public/ConfirmAppointmentPage'), 'ConfirmAppointmentPage')

export const appointmentsManifest: ModuleManifest = {
  key: 'appointments',
  labelKey: 'modules.appointments.name',
  dependsOn: ['clients', 'services', 'professionals'],
  nav: [{ path: '/agenda', labelKey: 'modules.appointments.agenda.title', icon: CalendarDays, permission: 'appointments.view', order: 12 }],
  routes: [{ path: 'agenda', permission: 'appointments.view', component: lazyPage(() => import('./pages/AgendaPage'), 'AgendaPage') }],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.appointmentsAuditLabels),
  settingsSections: [],
}
