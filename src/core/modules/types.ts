import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '@/i18n'

/**
 * A routed page. Use lazyPage() (`@/shared/lib/lazy-page`) so it loads in its own chunk and can be
 * preloaded: the shell prefetches the pages the user can open when the browser is idle.
 */
export type PageComponent = ComponentType & { preload?: () => Promise<unknown> }

export interface ModuleRoute {
  /** RELATIVE to the app root (no leading slash): 'professionnels' or 'professionnels/:id'. */
  path: string
  component: PageComponent
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
  /** Stable English identifier, unique across core and modules (error scopes, React keys): 'identity'. */
  id: string
  /** French URL segment under the settings base path, unique across core and modules: 'identite' (decision #24). */
  path: string
  labelKey: TranslationKey
  icon: LucideIcon
  /** Needed to see the section. */
  permission: string
  /**
   * Needed to change it. A user who can see the section without it reads it only: a lock in the
   * menu and the « Lecture seule » notice on the page. Omitted: whoever sees the section may change it.
   */
  editPermission?: string
  group: SettingsGroup
  component: PageComponent
  /**
   * The owning module, if any; used for the error-reporting scope (`settings:<moduleKey>:<id>`).
   * Stamped by the app shell from the manifest's key: manifests never set it.
   */
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
  /** The shell adds `moduleKey: key` to each (AuthenticatedApp). */
  settingsSections: Omit<SettingsSection, 'moduleKey'>[]
}
