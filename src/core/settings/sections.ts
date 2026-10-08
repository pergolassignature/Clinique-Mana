import { lazy } from 'react'
import {
  Blocks,
  Building2,
  Globe,
  Landmark,
  PenLine,
  Percent,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type { SettingsSection } from '@/core/modules/types'

const ComingSoonSection = lazy(() =>
  import('./pages/ComingSoonSection').then((m) => ({
    default: m.ComingSoonSection,
  }))
)

// English `id` for code, French `path` for the URL (decision #24). Menu order within each group.
// Sections still on ComingSoonSection are built by Tasks 2.9–2.18.
export const coreSettingsSections: SettingsSection[] = [
  {
    id: 'identity',
    path: 'identite',
    labelKey: 'settings.sections.identity',
    icon: Building2,
    permission: 'settings.view',
    editPermission: 'settings.manage',
    group: 'clinique',
    component: lazy(() =>
      import('./pages/IdentitySettingsPage').then((m) => ({
        default: m.IdentitySettingsPage,
      }))
    ),
  },
  {
    id: 'tax',
    path: 'fiscalite',
    labelKey: 'settings.sections.tax',
    icon: Percent,
    permission: 'settings.view',
    editPermission: 'settings.manage',
    group: 'clinique',
    component: lazy(() =>
      import('./pages/TaxSettingsPage').then((m) => ({
        default: m.TaxSettingsPage,
      }))
    ),
  },
  {
    id: 'signatory',
    path: 'signataire',
    labelKey: 'settings.sections.signatory',
    icon: PenLine,
    permission: 'settings.view',
    editPermission: 'settings.manage',
    group: 'clinique',
    component: ComingSoonSection,
  },
  {
    id: 'bank',
    path: 'banque',
    labelKey: 'settings.sections.bank',
    icon: Landmark,
    permission: 'settings.bank_manage',
    group: 'clinique',
    component: lazy(() =>
      import('./pages/BankSettingsPage').then((m) => ({
        default: m.BankSettingsPage,
      }))
    ),
  },
  {
    id: 'region',
    path: 'region',
    labelKey: 'settings.sections.region',
    icon: Globe,
    permission: 'settings.view',
    editPermission: 'settings.manage',
    group: 'clinique',
    component: ComingSoonSection,
  },
  {
    id: 'privacy',
    path: 'confidentialite',
    labelKey: 'settings.sections.privacy',
    icon: ShieldCheck,
    permission: 'settings.view',
    editPermission: 'settings.manage',
    group: 'clinique',
    component: ComingSoonSection,
  },
  {
    id: 'users',
    path: 'utilisateurs',
    labelKey: 'settings.sections.users',
    icon: Users,
    permission: 'users.view',
    editPermission: 'users.manage',
    group: 'plateforme',
    component: ComingSoonSection,
  },
  {
    id: 'modules',
    path: 'modules',
    labelKey: 'settings.sections.modules',
    icon: Blocks,
    permission: 'modules.manage',
    group: 'plateforme',
    component: lazy(() =>
      import('./pages/ModulesSettingsPage').then((m) => ({
        default: m.ModulesSettingsPage,
      }))
    ),
  },
  {
    id: 'audit',
    path: 'journal',
    labelKey: 'settings.sections.audit',
    icon: ScrollText,
    permission: 'audit.view',
    group: 'plateforme',
    component: ComingSoonSection,
  },
]
