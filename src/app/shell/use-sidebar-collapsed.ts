import { useCallback, useState } from 'react'

/** Per-device preference (not account data): which width the sidebar had last time. */
export const SIDEBAR_COLLAPSED_KEY = 'clinique-mana:sidebar-collapsed'

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

/** The desktop sidebar's collapsed state (56 px), remembered in localStorage. */
export function useSidebarCollapsed(): [collapsed: boolean, toggle: () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = useCallback(() => {
    const next = !collapsed
    writeCollapsed(next)
    setCollapsed(next)
  }, [collapsed])
  return [collapsed, toggle]
}
