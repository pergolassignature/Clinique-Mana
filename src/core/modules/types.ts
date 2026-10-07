import type { ComponentType, LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '@/i18n'

export interface ModuleRoute {
  /** Path relative to the app root, e.g. 'professionnels' or 'professionnels/:id'. */
  path: string
  component: LazyExoticComponent<ComponentType>
  permission: string
}

export interface ModuleNavItem {
  path: string
  labelKey: TranslationKey
  icon: LucideIcon
  permission: string
  /** Lower comes first in the menu. */
  order: number
}

export type SettingsGroup = 'clinique' | 'plateforme' | 'modules' | 'compte'

export interface SettingsSection {
  id: string
  labelKey: TranslationKey
  icon: LucideIcon
  permission: string
  group: SettingsGroup
  component: LazyExoticComponent<ComponentType>
}

export interface ModuleManifest {
  /** Must match public.modules.key. */
  key: string
  labelKey: TranslationKey
  dependsOn: string[]
  nav?: ModuleNavItem
  routes: ModuleRoute[]
  settingsSections: SettingsSection[]
}
