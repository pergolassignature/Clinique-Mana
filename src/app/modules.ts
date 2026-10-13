import type { ModuleManifest } from '@/core/modules/types'
import { appointmentsManifest } from '@/modules/appointments'
import { billingManifest } from '@/modules/billing'
import { clientsManifest } from '@/modules/clients'
import { communicationsManifest } from '@/modules/communications'
import { demandesManifest } from '@/modules/demandes'
import { professionalsManifest } from '@/modules/professionals'
import { reportsManifest } from '@/modules/reports'
import { servicesManifest } from '@/modules/services'

/** Every module the app knows about. A module only appears when enabled for the org (access.modules). */
export const ALL_MODULES: ModuleManifest[] = [
  professionalsManifest,
  servicesManifest,
  clientsManifest,
  communicationsManifest,
  demandesManifest,
  appointmentsManifest,
  billingManifest,
  reportsManifest,
]
