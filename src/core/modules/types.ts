import type { LucideIcon } from 'lucide-react'
import type { Access } from '@/core/access/access'
import type { TranslationKey } from '@/i18n'
import type { LazyPage } from '@/shared/lib/lazy-page'
import type { BadgeProps } from '@/shared/ui/badge'
import type { NavGroupId } from './nav-groups'

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
  /**
   * The menu section it shows under (decision NAV-1, `NAV_GROUPS` in `./nav-groups`): « Accueil des
   * clients », « Suivi »…; `main` for the professional's own pages, right after Accueil. Omitted:
   * « Autres », before « Paramètres ».
   */
  group?: NavGroupId
  /** Lower comes first within its section. */
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

/**
 * The slots a module may fill in another module's screen. The host renders each panel where the
 * slot is; a panel reads what it needs from the route (`client.visits`: the record's `:id`).
 *   `client.visits`: Clients' record, tab « Visites et paiements » (Rendez-vous R5, Facturation F2).
 *   `client.messages`: Clients' record, tab « Courriels » (Communications CM3: the linked threads, « Écrire »).
 *   `client.demandes`: Clients' record, tab « Demandes », shown only with a panel (Demandes: the file's requests, L18).
 *   `agenda.mine`: Rendez-vous' « Mon agenda », below the agenda (Facturation F3: the fees to decide).
 *   `professional.services`: Professionnels' record, tab « Jumelage », below the availability (Services:
 *     « Services offerts », L26). The panel reads the record's `:id` from the route.
 *   `appointment.sheet`: Rendez-vous' appointment sheet, tab « Facturation », shown only with a panel
 *     (Facturation: the appointment's invoice, price and fee, L10). The panel reads the appointment
 *     from `useSlotTarget('appointment.sheet')`, not from the route.
 */
export type ModuleSlotName = 'client.visits' | 'client.messages' | 'client.demandes' | 'agenda.mine' | 'appointment.sheet' | 'professional.services'

/** A panel a module adds to a slot, for whoever holds one of its permissions. */
export interface ModuleSlotItem {
  /** Stable English identifier, unique across modules (React key, error scope). */
  id: string
  /** Shown when the user holds any of these. */
  permissions: readonly string[]
  /** A lazyPage(): the host does not load the module's code for users who cannot see it. */
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

/**
 * A module section's heading in the settings menu (NAV-3): « Professionnels », « Facturation »… The
 * module names it; sections of several modules share one by `key` (Clients' and Demandes' « Clients
 * et demandes »), with the same `labelKey` and `order`. Headings follow `order`, then the sections
 * their registration order.
 */
export interface SettingsArea {
  /** Stable English identifier: 'billing'. */
  key: string
  labelKey: TranslationKey
  /** Lower comes first among the modules' headings. */
  order: number
}

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
  /** A `modules` section's heading (NAV-3); without one it is listed under « Modules ». */
  area?: SettingsArea
  /**
   * Former paths of this section (a section merged into another): each one opens it, with its
   * `search` (`?onglet=…`), so no link breaks.
   */
  redirects?: readonly { path: string; search: string }[]
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
  /** Its panels in other modules' screens, by slot (`ModuleSlotName`). */
  slots?: Partial<Record<ModuleSlotName, readonly ModuleSlotItem[]>>
  /**
   * The names and values of its audited tables, for the Journal d'audit. A loader: the labels
   * (and the formatting code they use) load in their own chunk when the journal opens, never on
   * the login page's entry path.
   */
  audit?: () => Promise<ModuleAuditLabels>
  /** The shell adds `moduleKey: key` to each (AuthenticatedApp). */
  settingsSections: Omit<SettingsSection, 'moduleKey'>[]
}
