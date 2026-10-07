import { createContext, useContext, useEffect, useId } from 'react'

/**
 * Unsaved-changes guard. The app uses `BrowserRouter`, so React Router's `useBlocker` is not
 * available (it needs a data router); forms register their dirty state here instead, and the ways
 * of leaving a page (`GuardedNavLink`, `useConfirmLeave`) ask before discarding it. The provider
 * also warns on tab close / reload (`beforeunload`).
 */
export interface UnsavedChangesValue {
  /** A form reports whether it has unsaved edits; call with false (or unmount) to clear. */
  setDirty: (id: string, dirty: boolean) => void
  /** Runs `proceed` at once when nothing is dirty, else after the user confirms leaving. */
  confirmLeave: (proceed: () => void) => void
  /** Whether any form has unsaved edits right now (read on demand, does not re-render). */
  isDirty: () => boolean
}

export const UnsavedChangesContext = createContext<UnsavedChangesValue | null>(null)

/** Registers a form's dirty state for the lifetime of the component. No-op outside a provider. */
export function useUnsavedChanges(dirty: boolean) {
  const setDirty = useContext(UnsavedChangesContext)?.setDirty
  const id = useId()
  useEffect(() => {
    if (!setDirty) return
    setDirty(id, dirty)
    return () => setDirty(id, false)
  }, [setDirty, id, dirty])
}

const proceedAtOnce = (proceed: () => void) => proceed()

/** `confirmLeave` for leaving by other means than a link (closing a sheet, cancelling). Outside a provider it proceeds at once. */
export function useConfirmLeave(): (proceed: () => void) => void {
  return useContext(UnsavedChangesContext)?.confirmLeave ?? proceedAtOnce
}
