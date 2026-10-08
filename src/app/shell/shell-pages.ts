import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '@/i18n'
import { isUnder } from '@/core/settings/paths'

/** A page the shell can name in the topbar. */
export interface ShellPage {
  /** Absolute path, e.g. '/parametres/modules'. */
  path: string
  labelKey: TranslationKey
}

export interface ShellNavItem extends ShellPage {
  icon: LucideIcon
  /** Pages under this item, named in the topbar as « Item / Sub-page » (e.g. the settings sections). */
  subPages?: ShellPage[]
}

/** « Mon compte » (Task 2.6): in the user menu and the palette, not in the sidebar. */
export const ACCOUNT_PAGE: ShellPage = {
  path: '/mon-compte',
  labelKey: 'nav.account',
}

/** The topbar's breadcrumb: an optional parent and the current page. */
export interface ShellTitle {
  parent: ShellPage | null
  current: ShellPage
}

/**
 * Names the current page from the nav items: the deepest item whose path contains the location,
 * then its sub-page if one matches. A location no item covers (not found) gets no title.
 */
export function resolveShellTitle(pathname: string, navItems: ShellNavItem[]): ShellTitle | null {
  if (isUnder(pathname, ACCOUNT_PAGE.path)) return { parent: null, current: ACCOUNT_PAGE }
  const item = navItems
    .filter((i) => isUnder(pathname, i.path))
    .reduce<ShellNavItem | undefined>((best, i) => (!best || i.path.length > best.path.length ? i : best), undefined)
  if (!item) return null
  const sub = item.subPages?.find((p) => isUnder(pathname, p.path))
  return sub ? { parent: item, current: sub } : { parent: null, current: item }
}
