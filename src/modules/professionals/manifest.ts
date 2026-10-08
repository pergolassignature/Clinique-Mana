import { Users } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

export const professionalsManifest: ModuleManifest = {
  key: 'professionals',
  labelKey: 'modules.professionals.name',
  dependsOn: [],
  nav: { path: '/professionnels', labelKey: 'modules.professionals.name', icon: Users, permission: 'professionals.view', order: 10 },
  routes: [
    { path: 'professionnels', permission: 'professionals.view', component: lazyPage(() => import('./pages/ProfessionalsPlaceholderPage')) },
  ],
  settingsSections: [],
}
