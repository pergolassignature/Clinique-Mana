import { createContext, useContext, useEffect, useId } from 'react'

/**
 * Unsaved-changes guard. The app uses `BrowserRouter`, so React Router's `useBlocker` is not
 * available (it needs a data router); forms register their dirty state here instead, and the ways
 * of leaving a page (`GuardedNavLink`, `useConfirmLeave`) ask before discarding it. The provider
 * also warns on tab close / reload (`beforeunload`).
 *
 * The guard is page-wide: it knows that *some* form is dirty, not which one. So it is for leaving
 * the page (or the settings section). A sheet or dialog that closes over the page must check its
 * own form's dirty state (e.g. react-hook-form's `formState.isDirty`), not this global one —
 * otherwise an unrelated dirty card on the page would prompt when closing it.
 */
export interface UnsavedChangesValue {
  /** A form reports whether it has unsaved edits; call with false (or unmount) to clear. */
  setDirty: (id: string, dirty: boolean) => void
  /**
   * Runs `proceed` at once when nothing is dirty, else after the user confirms leaving.
   * Confirming does not clear the dirty forms: the ones that really leave unregister on unmount.
   * It only lets one `beforeunload` through while `proceed` runs, so a full-page navigation there
   * does not ask a second time.
   */
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

/**
 * `confirmLeave` for leaving the page by other means than a link (e.g. a programmatic navigation
 * after « Annuler »). Not for closing a sheet or dialog: see the note at the top of this file.
 * Outside a provider it proceeds at once.
 */
export function useConfirmLeave(): (proceed: () => void) => void {
  return useContext(UnsavedChangesContext)?.confirmLeave ?? proceedAtOnce
}
