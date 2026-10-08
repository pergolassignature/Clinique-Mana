import { useCallback, useState, useSyncExternalStore } from 'react'

/** Per-device preference (not account data): which width the sidebar had last time. Same style as `clinique-mana-auth`. */
export const SIDEBAR_COLLAPSED_KEY = 'clinique-mana-sidebar-collapsed'

/**
 * Tablets (md to lg): the sidebar is there (below md it is a sheet) but 220 px of a 768 px screen
 * leaves the page about 500 px, narrower than the reference lists. There it starts as the 56 px
 * icon rail (PS Hub collapses below xl the same way).
 */
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)'

// Storage can throw (private mode, blocked site data): the sidebar then simply starts expanded.
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
  } catch {
    // Not remembered on this device; the toggle still works for this visit.
  }
}

const tabletQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia(TABLET_QUERY) : null)

function subscribeTablet(onChange: () => void) {
  const query = tabletQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

const isTablet = () => tabletQuery()?.matches ?? false

/**
 * The sidebar's collapsed state (56 px). From lg it is the remembered desktop choice. On a tablet
 * it starts collapsed whatever that choice is; expanding it there lasts until the window leaves the
 * tablet range and never changes the desktop choice.
 */
export function useSidebarCollapsed(): [collapsed: boolean, toggle: () => void] {
  const [stored, setStored] = useState(readCollapsed)
  const tablet = useSyncExternalStore(subscribeTablet, isTablet, () => false)
  const [tabletExpanded, setTabletExpanded] = useState(false)
  // Leaving the tablet range forgets the expansion: back on a tablet, the rail again.
  const [wasTablet, setWasTablet] = useState(tablet)
  if (wasTablet !== tablet) {
    setWasTablet(tablet)
    setTabletExpanded(false)
  }

  const collapsed = tablet ? !tabletExpanded : stored
  const toggle = useCallback(() => {
    if (tablet) {
      setTabletExpanded((expanded) => !expanded)
      return
    }
    const next = !stored
    writeCollapsed(next)
    setStored(next)
  }, [tablet, stored])
  return [collapsed, toggle]
}
