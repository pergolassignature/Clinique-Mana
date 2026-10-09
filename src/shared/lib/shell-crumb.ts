import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * The topbar's last crumb, set by a detail page the nav items cannot name (a professional's record:
 * « Professionnels / Marie Tremblay »). Two contexts: pages only get the stable setter, so a crumb
 * change re-renders the topbar alone.
 */
const CrumbContext = createContext<string | null>(null)
const SetCrumbContext = createContext<(label: string | null) => void>(() => {})

/** Holds the crumb for the shell (AppShell): the topbar reads it, the routed page sets it. */
export function ShellCrumbProvider({ children }: { children: ReactNode }) {
  const [crumb, setCrumb] = useState<string | null>(null)
  return createElement(SetCrumbContext.Provider, { value: setCrumb }, createElement(CrumbContext.Provider, { value: crumb }, children))
}

/** The current crumb (topbar only). */
export function useShellCrumbLabel(): string | null {
  return useContext(CrumbContext)
}

/**
 * Shows `label` as the topbar's last crumb while the calling page is mounted (cleared on unmount).
 * null leaves the crumb alone: a layout around the detail page (effects run child first) must not
 * clear what the page just set. No-op outside the shell (pages rendered alone in tests).
 */
export function useShellCrumb(label: string | null): void {
  const setCrumb = useContext(SetCrumbContext)
  useEffect(() => {
    if (label === null) return
    setCrumb(label)
    return () => setCrumb(null)
  }, [label, setCrumb])
}
