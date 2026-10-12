import type { ModuleManifest } from '@/core/modules/types'
import { clientsManifest } from '@/modules/clients'
import { communicationsManifest } from '@/modules/communications'
import { professionalsManifest } from '@/modules/professionals'
import { servicesManifest } from '@/modules/services'

/** Every module the app knows about. A module only appears when enabled for the org (access.modules). */
export const ALL_MODULES: ModuleManifest[] = [professionalsManifest, servicesManifest, clientsManifest, communicationsManifest]
