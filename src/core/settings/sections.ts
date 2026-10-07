import { lazy } from 'react'
import { Blocks } from 'lucide-react'
import type { SettingsSection } from '@/core/modules/types'

// Phase 2 adds: identité, fiscalité, signataire, banque, lieux, région, confidentialité,
// utilisateurs, courriels, signature électronique, intégrations, tâches planifiées, audit.
export const coreSettingsSections: SettingsSection[] = [
  {
    id: 'modules',
    labelKey: 'settings.sections.modules',
    icon: Blocks,
    permission: 'modules.manage',
    group: 'plateforme',
    component: lazy(() => import('./pages/ModulesSettingsPage').then((m) => ({ default: m.ModulesSettingsPage }))),
  },
]
