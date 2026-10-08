import { createContext, useContext, useEffect, useId, type FocusEvent, type KeyboardEvent } from 'react'

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
 * after « Annuler », or a page tab that unmounts the current tab's forms: `useGuardedTabs`). Not
 * for closing a sheet or dialog: see the note at the top of this file. Outside a provider it
 * proceeds at once.
 */
export function useConfirmLeave(): (proceed: () => void) => void {
  return useContext(UnsavedChangesContext)?.confirmLeave ?? proceedAtOnce
}

/**
 * Page tabs (`@/shared/ui/tabs`) whose panels unmount, and with them their forms' edits: a switch
 * asks first while a form is dirty. `onValueChange` goes on `Tabs`, `triggerProps(value)` on each
 * `TabsTrigger`. While nothing is dirty the tabs behave as usual (the arrow keys switch views).
 * While a form is dirty:
 * - focus does not activate a tab (Radix skips its handler once the default is prevented): the
 *   arrow keys only move focus, and focus coming back to the tab after « Rester » asks nothing;
 * - Entrée / Espace ask with their default prevented: Radix activates tabs on keydown, and the
 *   key's own click would otherwise land on the dialog's « Rester », which takes focus at once.
 */
export function useGuardedTabs<T extends string>(current: T, isTab: (value: string) => value is T, select: (value: T) => void) {
  const context = useContext(UnsavedChangesContext)
  const confirmLeave = context?.confirmLeave ?? proceedAtOnce
  const isDirty = () => context?.isDirty() ?? false
  const onValueChange = (value: string) => {
    if (isTab(value) && value !== current) confirmLeave(() => select(value))
  }
  const triggerProps = (value: T) => ({
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (isDirty()) event.preventDefault()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if ((event.key === 'Enter' || event.key === ' ') && isDirty()) {
        event.preventDefault()
        onValueChange(value)
      }
    },
  })
  return { onValueChange, triggerProps }
}
