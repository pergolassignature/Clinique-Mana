import { CircleUser, Compass, FileCheck, FileSignature, FileText, FolderOpen, GraduationCap, HandCoins, Languages, Send, ShieldCheck, Tags, UserMinus, Users } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. Every page is a
// lazyPage; the API, hooks and schemas load with them.


/** « Mon profil » and Accueil's card: an account linked to a professional file (P4-376). */
const hasProfessionalFile = (access: Access) => access.has_professional_file

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
  nav: [
    { path: '/professionnels', labelKey: 'modules.professionals.name', icon: Users, permission: 'professionals.view', order: 10 },
    // The professional's own file (Task 4b.5), right after Accueil, for an account linked to a file
    // (P4-376): admins hold professionals.self by default without one; an admin who practises keeps it.
    {
      path: '/mon-profil',
      labelKey: 'modules.professionals.myProfile.nav',
      icon: CircleUser,
      permission: 'professionals.self',
      shownWhen: hasProfessionalFile,
      order: 5,
    },
    // « Mes documents » (Task 4c.6): the professional's own documents, right after « Mon profil ».
    {
      path: '/mes-documents',
      labelKey: 'modules.professionals.myDocuments.nav',
      icon: FolderOpen,
      permission: 'professionals.self',
      shownWhen: hasProfessionalFile,
      order: 6,
    },
  ],
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
    // « Mon profil » (4b.5): the professional's own file, read-only, and « Mettre mon profil à jour ».
    { path: 'mon-profil', permission: 'professionals.self', component: lazyPage(() => import('./pages/self/MyProfilePage'), 'MyProfilePage') },
    // The provider's questionnaire (4b.4): where an accepted invitation lands (P4-266) and where an
    // update request leads. No nav item of its own: « Mon profil » and Accueil link to it.
    {
      path: 'mon-profil/questionnaire',
      permission: 'professionals.self',
      component: lazyPage(() => import('./pages/self/QuestionnairePage'), 'QuestionnairePage'),
    },
    // « Mes documents » (4c.6): her documents, « Téléverser », the insurance's banner.
    { path: 'mes-documents', permission: 'professionals.self', component: lazyPage(() => import('./pages/self/MyDocumentsPage'), 'MyDocumentsPage') },
  ],
  // Accueil « Complétez votre profil » (P4-319): the professional's open questionnaire, if any. Only
  // for an account linked to a file: an admin without one never reads a questionnaire (P4-376).
  homeCards: [
    {
      id: 'professionals-profile',
      permission: 'professionals.self',
      shownWhen: hasProfessionalFile,
      component: lazyPage(() => import('./components/self/ProfileHomeCard'), 'ProfileHomeCard'),
    },
  ],
  // The global search (⌘K): name, email, licence and IVAC number. Staff who read the list only:
  // the provider (professionals.self) finds « Mon profil » among the pages, never a record.
  search: [
    {
      id: 'professionals',
      labelKey: 'modules.professionals.name',
      icon: Users,
      permission: 'professionals.view',
      minChars: 2,
      load: () => import('./search').then((m) => m.searchProfessionals),
    },
  ],
  // The Journal d'audit's names and values for the module's tables (gap audit V10): loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.professionalsAuditLabels),
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
      // The document types a file holds (Task 4c.3): read like the lists, changed with `professionals.settings`.
      id: 'required-documents',
      path: 'documents-requis',
      labelKey: 'modules.professionals.settings.requiredDocuments.title',
      icon: FileCheck,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/RequiredDocumentsSettingsPage'), 'RequiredDocumentsSettingsPage'),
    },
    {
      // The image consent's versions (Task 4c.3, P4-452): read by the lists' readers, changed with `professionals.settings`.
      id: 'consents',
      path: 'consentements',
      labelKey: 'modules.professionals.settings.consents.title',
      icon: ShieldCheck,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/ConsentsSettingsPage'), 'ConsentsSettingsPage'),
    },
    {
      // What the fiche given to clients shows (P4-353): read like the lists, changed with `professionals.settings`.
      id: 'fiche',
      path: 'fiche-pdf',
      labelKey: 'modules.professionals.settings.fiche.title',
      icon: FileText,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/FicheSettingsPage'), 'FicheSettingsPage'),
    },
    {
      // The service contract's template (Task 4d.3, A5.7): seen by whoever manages records or edits
      // the module's settings, changed with `professionals.settings` (the template's edit permission).
      id: 'contracts',
      path: 'contrats',
      labelKey: 'modules.professionals.settings.contracts.title',
      icon: FileSignature,
      ...LIST_SECTION,
      component: lazyPage(() => import('./pages/settings/ContractsSettingsPage'), 'ContractsSettingsPage'),
    },
    {
      // The invitation link's lifetime and the automatic reminder (Task 4b.3): seen by whoever
      // invites or edits the module's settings, changed with `professionals.settings`.
      id: 'invitations',
      path: 'invitations',
      labelKey: 'modules.professionals.settings.invitations.title',
      icon: Send,
      permission: ['professionals.invite', 'professionals.settings'],
      editPermission: 'professionals.settings',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/InvitationsSettingsPage'), 'InvitationsSettingsPage'),
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
