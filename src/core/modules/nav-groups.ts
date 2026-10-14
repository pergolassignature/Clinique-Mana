import type { TranslationKey } from '@/i18n'

/**
 * The sections of the main menu (decision NAV-1), in menu order. A module's nav item names its
 * section (`ModuleNavItem.group`); core owns the list, so a new module picks one of these.
 *   `main`: Accueil and the professional's own pages (« Mon profil », « Mon agenda »…), unlabelled.
 *   `other`: where an item without a section goes, so nothing disappears.
 *   `settings`: « Paramètres », unlabelled, always last.
 */
export const NAV_GROUPS = [
  { id: 'main', labelKey: null },
  { id: 'intake', labelKey: 'nav.groups.intake' },
  { id: 'followUp', labelKey: 'nav.groups.followUp' },
  { id: 'billing', labelKey: 'nav.groups.billing' },
  { id: 'communications', labelKey: 'nav.groups.communications' },
  // NAV-2: every report in one section, after the day's work.
  { id: 'reports', labelKey: 'nav.groups.reports' },
  { id: 'team', labelKey: 'nav.groups.team' },
  { id: 'other', labelKey: 'nav.groups.other' },
  { id: 'settings', labelKey: null },
] as const satisfies readonly { id: string; labelKey: TranslationKey | null }[]

export type NavGroupId = (typeof NAV_GROUPS)[number]['id']

/** The section of an item that names none. */
export const DEFAULT_NAV_GROUP: NavGroupId = 'other'

export interface NavGroup<T> {
  id: NavGroupId
  /** The section's heading; null: no heading (Accueil's and Paramètres' sections). */
  labelKey: TranslationKey | null
  items: T[]
}

/**
 * The menu's items by section: the sections in NAV_GROUPS order, each item in its section by
 * `order` (lower first; equal or missing: as given), a section with no item left out (a user who
 * sees nothing in « Facturation » sees no « Facturation » heading).
 */
export function groupNavItems<T extends { group?: NavGroupId; order?: number }>(items: readonly T[]): NavGroup<T>[] {
  return NAV_GROUPS.map((g) => ({
    id: g.id,
    labelKey: g.labelKey,
    items: items.filter((item) => (item.group ?? DEFAULT_NAV_GROUP) === g.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  })).filter((g) => g.items.length > 0)
}
