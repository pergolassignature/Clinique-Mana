import type { ModuleManifest } from '@/core/modules/types'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only.

/**
 * Module Rendez-vous (plan §7): the clinic's agenda. R1 is the schema and the booking RPCs: the
 * professionals' availability (weekly windows, exceptions), the appointments with their clients
 * and presence, the cancellation reasons, the business hours; no screen yet (the agenda is R2,
 * « Mon agenda » R5). Depends on Clients (the files), Services et tarifs (durations, « pause
 * après », who offers what) and Professionnels.
 */
export const appointmentsManifest: ModuleManifest = {
  key: 'appointments',
  labelKey: 'modules.appointments.name',
  dependsOn: ['clients', 'services', 'professionals'],
  routes: [],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.appointmentsAuditLabels),
  settingsSections: [],
}
