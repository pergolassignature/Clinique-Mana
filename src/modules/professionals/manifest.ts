import { Compass, GraduationCap, Languages, Tags, UserMinus, Users } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/** Until 4a.6–4a.11 replace them: one lazyPage per entry, so each lane changes its own line. */
const placeholder = () => lazyPage(() => import('./pages/ProfessionalsPlaceholderPage'), 'ProfessionalsPlaceholderPage')
const settingsPlaceholder = () => lazyPage(() => import('./pages/ProfessionalsPlaceholderPage'), 'ProfessionalsSettingsPlaceholder')

/**
 * The lists are seen by whoever manages records (the adjointe, read-only) or edits the lists
 * (`list_professionals_reference_usage` serves both), and changed with `professionals.settings`.
 */
const LIST_SECTION = {
  permission: ['professionals.manage', 'professionals.settings'],
  editPermission: 'professionals.settings',
  group: 'modules',
} as const

export const professionalsManifest: ModuleManifest = {
  key: 'professionals',
  labelKey: 'modules.professionals.name',
  dependsOn: [],
  nav: { path: '/professionnels', labelKey: 'modules.professionals.name', icon: Users, permission: 'professionals.view', order: 10 },
  routes: [
    // 4a.10: ProfessionalsListPage
    { path: 'professionnels', permission: 'professionals.view', component: placeholder() },
    // 4a.11: ProfessionalRecordPage (the tab is a URL segment: apercu, jumelage… RECORD_TABS)
    { path: 'professionnels/:id/:onglet?', permission: 'professionals.view', component: placeholder() },
  ],
  settingsSections: [
    // 4a.7
    { id: 'professions', path: 'professions', labelKey: 'modules.professionals.settings.professions.title', icon: GraduationCap, ...LIST_SECTION, component: settingsPlaceholder() },
    // 4a.8 (clientèles and approaches)
    { id: 'specialties', path: 'specialites', labelKey: 'modules.professionals.settings.specialties.title', icon: Compass, ...LIST_SECTION, component: settingsPlaceholder() },
    // 4a.9
    { id: 'motifs', path: 'motifs', labelKey: 'modules.professionals.settings.motifs.title', icon: Tags, ...LIST_SECTION, component: settingsPlaceholder() },
    // 4a.6
    { id: 'languages', path: 'langues', labelKey: 'modules.professionals.settings.languages.title', icon: Languages, ...LIST_SECTION, component: settingsPlaceholder() },
    // 4a.6
    {
      id: 'deactivation-reasons',
      path: 'raisons-desactivation',
      labelKey: 'modules.professionals.settings.deactivationReasons.title',
      icon: UserMinus,
      ...LIST_SECTION,
      component: settingsPlaceholder(),
    },
  ],
}
