import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@/i18n'
import { UnsavedChangesContext, type UnsavedChangesValue } from '@/shared/lib/unsaved-changes-context'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'

/** Holds which forms are dirty, confirms before leaving them, and warns on tab close while any is. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyIds = useRef(new Set<string>())
  // Mirrors `dirtyIds.size > 0` so the beforeunload listener exists only while needed
  // (a permanent one would keep pages out of the back/forward cache in some browsers).
  const [hasDirty, setHasDirty] = useState(false)
  const [pending, setPending] = useState<(() => void) | null>(null)
  // Set by « Quitter » around `proceed`: lets one beforeunload through, so a full-page navigation
  // done synchronously inside `proceed` does not ask twice. Cleared on the next task (even if
  // `proceed` throws), so after an in-app leave the forms still dirty keep their tab-close warning.
  const bypassUnload = useRef(false)
  // Where focus was when the dialog opened, to return it when the dialog closes.
  const returnFocus = useRef<HTMLElement | null>(null)

  const setDirty = useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyIds.current.add(id)
    else dirtyIds.current.delete(id)
    setHasDirty(dirtyIds.current.size > 0)
  }, [])

  const isDirty = useCallback(() => dirtyIds.current.size > 0, [])

  const confirmLeave = useCallback((proceed: () => void) => {
    if (dirtyIds.current.size === 0) {
      proceed()
      return
    }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Wrapped: a function passed to setState would be called as an updater.
    setPending(() => proceed)
  }, [])

  useEffect(() => {
    if (!hasDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypassUnload.current) {
        bypassUnload.current = false
        return
      }
      event.preventDefault()
      event.returnValue = '' // older Chromium and Safari still need it
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasDirty])

  // Does not clear the dirty ids: forms that really leave unregister on unmount, the others stay guarded.
  const leave = () => {
    const proceed = pending
    bypassUnload.current = true
    setPending(null)
    try {
      proceed?.()
    } finally {
      setTimeout(() => {
        bypassUnload.current = false
      }, 0)
    }
  }

  const onCloseAutoFocus = (event: Event) => {
    // No AlertDialogTrigger to return to: put focus back where it was, after « Rester », Escape or
    // « Quitter » alike, as long as that element is still on the page (a sidebar link usually is).
    event.preventDefault()
    if (returnFocus.current?.isConnected) returnFocus.current.focus()
    returnFocus.current = null
  }

  const value = useMemo<UnsavedChangesValue>(() => ({ setDirty, confirmLeave, isDirty }), [setDirty, confirmLeave, isDirty])

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.unsaved.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('common.unsaved.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Radix focuses Cancel first: « Rester » is the safe default. */}
            <AlertDialogCancel>{t('common.unsaved.stay')}</AlertDialogCancel>
            {/* A plain Button with the soft destructive variant; clearing `pending` closes the dialog. */}
            <Button variant="destructive" onClick={leave}>
              {t('common.unsaved.leave')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UnsavedChangesContext.Provider>
  )
}
