import type { LucideIcon } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { TranslationKey } from '@/i18n'
import type { LazyPage } from '@/shared/lib/lazy-page'
import type { BadgeProps } from '@/shared/ui/badge'

export interface ModuleRoute {
  /** RELATIVE to the app root (no leading slash): 'professionnels' or 'professionnels/:id'. */
  path: string
  /**
   * A lazyPage() (`@/shared/lib/lazy-page`): its own chunk, which the shell prefetches when the
   * browser is idle and loads with the access at a reload.
   */
  component: LazyPage
  permission: string
}

export interface ModuleNavItem {
  /** ABSOLUTE link target (leading slash): '/professionnels'. */
  path: string
  labelKey: TranslationKey
  icon: LucideIcon
  permission: string
  /**
   * Shown only when this also holds for the signed-in user, beyond the permission: « Mon profil »
   * (`professionals.self`) needs a professional file linked to the account (P4-376), since admins
   * hold that key by default without one.
   */
  shownWhen?: (access: Access) => boolean
  /** Lower comes first in the menu. */
  order: number
}

/** A card a module adds to Accueil, for whoever holds its permission (it renders nothing when it has nothing to say). */
export interface ModuleHomeCard {
  /** Stable English identifier, unique across modules (React key, error scope). */
  id: string
  permission: string
  /** As `ModuleNavItem.shownWhen`: a further condition on the signed-in user. */
  shownWhen?: (access: Access) => boolean
  /** A lazyPage(): Accueil does not load the module's code for users who cannot see the card. */
  component: LazyPage
}

/** One record the global search (⌘K) found. */
export interface ModuleSearchResult {
  /** Unique within its provider (React key, cmdk value). */
  id: string
  title: string
  /** One muted line under the title (« Psychologue · OPQ 12345-08 »). */
  subtitle?: string
  /** ABSOLUTE path the result opens: '/professionnels/<id>'. */
  href: string
  /** Defaults to the provider's icon. */
  icon?: LucideIcon
  /** A status, as in the module's own list. */
  badge?: { label: string; tone: NonNullable<BadgeProps['variant']> }
}

/** A module's search: results for the query, cancelled through `signal` when the query changes. */
export type ModuleSearchFn = (query: string, signal: AbortSignal) => Promise<ModuleSearchResult[]>

/**
 * A group of records in the global search (⌘K « Rechercher… »). The palette asks every provider of
 * the enabled modules whose permission the user holds, once the query has `minChars` characters;
 * a disabled module or a missing permission contributes nothing. Core never imports the module:
 * `load` brings its search code (API, labels) in its own chunk, only when the palette searches.
 */
export interface ModuleSearchProvider {
  /** Stable English identifier, unique across modules: 'professionals' (React key, query key). */
  id: string
  /** The group's heading: « Professionnels ». */
  labelKey: TranslationKey
  icon: LucideIcon
  permission: string
  /** Characters (spaces aside) before the provider is asked; 2 when omitted. */
  minChars?: number
  load: () => Promise<ModuleSearchFn>
}

/**
 * What a module tells the Journal d'audit about its own tables (Paramètres → Journal d'audit):
 * their French names, the columns' names and how its stored values read. Core never imports a
 * module; it asks the enabled modules' `ModuleManifest.audit` loaders. `i18nAuditLabels`
 * (`@/core/audit/module-labels`) builds one from an i18n prefix.
 */
export interface ModuleAuditLabels {
  /** The module's audited tables, in the order of the « Section » filter. */
  tables: readonly string[]
  /** The French name of one of its tables; undefined for any other table. */
  tableLabel: (table: string) => string | undefined
  /** The French name of a column of one of its tables; undefined lets core use the shared names (`audit.commonFields`). */
  fieldLabel: (table: string, column: string) => string | undefined
  /** A stored value of one of its tables as read (a status, a month, an amount); undefined lets core format it. */
  value: (table: string, column: string, value: unknown) => string | undefined
  /** Who wrote a row with no actor (`audit_log.source`), for the module's own sources (« Importation »); undefined otherwise. */
  sourceLabel: (source: string) => string | undefined
}

export type SettingsGroup = 'clinique' | 'plateforme' | 'modules' | 'compte'

export interface SettingsSection {
  /** Stable English identifier, unique across core and modules (error scopes, React keys): 'identity'. */
  id: string
  /** French URL segment under the settings base path, unique across core and modules: 'identite' (decision #24). */
  path: string
  labelKey: TranslationKey
  icon: LucideIcon
  /** Needed to see the section: one key, or several meaning any of them. */
  permission: string | readonly string[]
  /**
   * Needed to change it: one key, or several meaning any of them. A user who can see the section
   * without it reads it only: a lock in the menu and the « Lecture seule » notice on the page.
   * Omitted: whoever sees the section may change it.
   */
  editPermission?: string | readonly string[]
  group: SettingsGroup
  /** A lazyPage(), as for ModuleRoute. */
  component: LazyPage
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
  /** Its menu entries: one, or several (Professionnels and « Mon profil »). */
  nav?: ModuleNavItem | readonly ModuleNavItem[]
  routes: ModuleRoute[]
  /** Cards on Accueil, in this order, between the greeting and the important notices. */
  homeCards?: readonly ModuleHomeCard[]
  /** Its record groups in the global search (⌘K), in this order. */
  search?: readonly ModuleSearchProvider[]
  /**
   * The names and values of its audited tables, for the Journal d'audit. A loader: the labels
   * (and the formatting code they use) load in their own chunk when the journal opens, never on
   * the login page's entry path.
   */
  audit?: () => Promise<ModuleAuditLabels>
  /** The shell adds `moduleKey: key` to each (AuthenticatedApp). */
  settingsSections: Omit<SettingsSection, 'moduleKey'>[]
}
