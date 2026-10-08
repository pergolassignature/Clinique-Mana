import { Compass, GraduationCap, HandCoins, Languages, Tags, UserMinus, Users } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.


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
    // « Révision mensuelle » (P4-190): the retention program's monthly page, compensation holders only.
    // A static segment: React Router ranks it above the record's `:id`, whatever the order.
    {
      path: 'professionnels/revision-mensuelle',
      permission: 'professionals.compensation',
      component: lazyPage(() => import('./pages/RetentionReviewPage'), 'RetentionReviewPage'),
    },
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
      // « Spécialités » until P4-240 removed the approaches: only the clientèles are left.
      id: 'clienteles',
      path: 'clienteles',
      labelKey: 'modules.professionals.settings.clienteles.title',
      icon: Compass,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/ClientelesSettingsPage'), 'ClientelesSettingsPage'),
    },
    {
      id: 'motifs',
      path: 'motifs',
      labelKey: 'modules.professionals.settings.motifs.title',
      icon: Tags,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/MotifsSettingsPage'), 'MotifsSettingsPage'),
    },
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
    {
      // The clinic's compensation terms: seen and changed with `professionals.compensation` (no
      // read-only mode). « Recueillir le NAS » inside also needs `.private` and `.settings` (P4-160).
      id: 'compensation',
      path: 'remuneration',
      labelKey: 'modules.professionals.settings.compensation.title',
      icon: HandCoins,
      permission: 'professionals.compensation',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/CompensationSettingsPage'), 'CompensationSettingsPage'),
    },
  ],
}
