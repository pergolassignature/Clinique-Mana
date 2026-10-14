import { useCallback } from 'react'
import { useGuardedTabs } from './unsaved-changes-context'
import { useUrlParams } from './use-url-params'

/** The address parameter that names a page's open tab (`?onglet=prix`). */
export const TAB_PARAM = 'onglet'

/**
 * A page's tabs (decision #35: real Radix tabs, one tab stop, the arrows switch) whose open tab is
 * in the address, `?onglet=<slug>` (French slugs), so a link or a reload opens the same tab. The
 * first tab is the default and leaves the address clean; an unknown or no longer visible slug
 * (a tab the user cannot see) opens the first one. A switch asks first while a form of the open
 * tab is dirty (`useGuardedTabs`: its panel unmounts, and its edits with it).
 *
 * `tabs`: the slugs the user can see, in order (at least one). `onValueChange` goes on `Tabs`,
 * `triggerProps(slug)` on each `TabsTrigger`.
 */
export function usePageTabs<T extends string>(tabs: readonly T[]) {
  const { params, update } = useUrlParams()
  const first = tabs[0]
  if (first === undefined) throw new Error('usePageTabs: no tab')
  const requested = params.get(TAB_PARAM)
  const isTab = useCallback((value: string): value is T => (tabs as readonly string[]).includes(value), [tabs])
  const tab: T = requested !== null && isTab(requested) ? requested : first
  const select = useCallback((value: T) => update({ [TAB_PARAM]: value === first ? null : value }), [update, first])
  const { onValueChange, triggerProps } = useGuardedTabs(tab, isTab, select)
  return { tab, onValueChange, triggerProps }
}
