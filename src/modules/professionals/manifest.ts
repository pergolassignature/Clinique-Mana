import { Compass, GraduationCap, Languages, Tags, UserMinus, Users } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.

/** Until 4a.9 replaces it. */
const settingsPlaceholder = () => lazyPage(() => import('./pages/ProfessionalsPlaceholderPage'), 'ProfessionalsSettingsPlaceholder')

/** The record page, also preloaded by the list (row hover or focus). */
export const professionalRecordPage = lazyPage(() => import('./pages/ProfessionalRecordPage'), 'ProfessionalRecordPage')

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
    { path: 'professionnels', permission: 'professionals.view', component: lazyPage(() => import('./pages/ProfessionalsListPage'), 'ProfessionalsListPage') },
    // The tab is a URL segment: apercu, jumelage… (RECORD_TABS)
    { path: 'professionnels/:id/:onglet?', permission: 'professionals.view', component: professionalRecordPage },
  ],
  settingsSections: [
    {
      id: 'professions',
      path: 'professions',
      labelKey: 'modules.professionals.settings.professions.title',
      icon: GraduationCap,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/ProfessionsSettingsPage'), 'ProfessionsSettingsPage'),
    },
    {
      id: 'specialties',
      path: 'specialites',
      labelKey: 'modules.professionals.settings.specialties.title',
      icon: Compass,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/SpecialtiesSettingsPage'), 'SpecialtiesSettingsPage'),
    },
    // 4a.9
    { id: 'motifs', path: 'motifs', labelKey: 'modules.professionals.settings.motifs.title', icon: Tags, ...LIST_SECTION, component: settingsPlaceholder() },
    {
      id: 'languages',
      path: 'langues',
      labelKey: 'modules.professionals.settings.languages.title',
      icon: Languages,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/LanguagesSettingsPage'), 'LanguagesSettingsPage'),
    },
    {
      id: 'deactivation-reasons',
      path: 'raisons-desactivation',
      labelKey: 'modules.professionals.settings.deactivationReasons.title',
      icon: UserMinus,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/DeactivationReasonsSettingsPage'), 'DeactivationReasonsSettingsPage'),
    },
  ],
}
