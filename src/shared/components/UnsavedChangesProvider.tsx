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

  const setDirty = useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyIds.current.add(id)
    else dirtyIds.current.delete(id)
    setHasDirty(dirtyIds.current.size > 0)
  }, [])

  const isDirty = useCallback(() => dirtyIds.current.size > 0, [])

  const confirmLeave = useCallback((proceed: () => void) => {
    if (dirtyIds.current.size === 0) proceed()
    // Wrapped: a function passed to setState would be called as an updater.
    else setPending(() => proceed)
  }, [])

  useEffect(() => {
    if (!hasDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = '' // older Chromium and Safari still need it
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasDirty])

  const leave = () => {
    const proceed = pending
    dirtyIds.current.clear()
    setHasDirty(false)
    setPending(null)
    proceed?.()
  }

  const value = useMemo<UnsavedChangesValue>(() => ({ setDirty, confirmLeave, isDirty }), [setDirty, confirmLeave, isDirty])

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.unsaved.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('common.unsaved.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Radix focuses Cancel first: « Rester » is the safe default. */}
            <AlertDialogCancel>{t('common.unsaved.stay')}</AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction: the action's default (primary) classes would leak
                shadow-soft into the soft destructive variant. Clearing `pending` closes the dialog. */}
            <Button variant="destructive" onClick={leave}>
              {t('common.unsaved.leave')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UnsavedChangesContext.Provider>
  )
}
