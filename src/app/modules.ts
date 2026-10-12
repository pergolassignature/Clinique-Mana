import type { ModuleManifest } from '@/core/modules/types'
import { communicationsManifest } from '@/modules/communications'
import { professionalsManifest } from '@/modules/professionals'

/** Every module the app knows about. A module only appears when enabled for the org (access.modules). */
export const ALL_MODULES: ModuleManifest[] = [professionalsManifest, communicationsManifest]
