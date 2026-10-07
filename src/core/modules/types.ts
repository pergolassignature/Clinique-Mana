import type { ComponentType, LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '@/i18n'

export interface ModuleRoute {
  /** RELATIVE to the app root (no leading slash): 'professionnels' or 'professionnels/:id'. */
  path: string
  component: LazyExoticComponent<ComponentType>
  permission: string
}

export interface ModuleNavItem {
  /** ABSOLUTE link target (leading slash): '/professionnels'. */
  path: string
  labelKey: TranslationKey
  icon: LucideIcon
  permission: string
  /** Lower comes first in the menu. */
  order: number
}

export type SettingsGroup = 'clinique' | 'plateforme' | 'modules' | 'compte'

export interface SettingsSection {
  /** URL segment under the settings base path; must be unique across core and all modules. */
  id: string
  labelKey: TranslationKey
  icon: LucideIcon
  permission: string
  group: SettingsGroup
  component: LazyExoticComponent<ComponentType>
  /** The owning module, if any; used for the error-reporting scope (`settings:<moduleKey>:<id>`). */
  moduleKey?: string
}

export interface ModuleManifest {
  /** Must equal public.modules.key (English, e.g. 'professionals'). */
  key: string
  labelKey: TranslationKey
  /** Keys of the modules this one requires (mirrors public.module_dependencies). Never lists 'core', which is implicit. */
  dependsOn: string[]
  nav?: ModuleNavItem
  routes: ModuleRoute[]
  settingsSections: SettingsSection[]
}
