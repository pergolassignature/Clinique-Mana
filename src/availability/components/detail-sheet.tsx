import { useState, useCallback } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'

interface DetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  hasUnsavedChanges?: boolean
}

export function DetailSheet({
  open,
  onOpenChange,
  title,
  children,
  hasUnsavedChanges = false,
}: DetailSheetProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && hasUnsavedChanges) {
        setShowConfirmDialog(true)
      } else {
        onOpenChange(newOpen)
      }
    },
    [hasUnsavedChanges, onOpenChange]
  )

  const handleConfirmClose = useCallback(() => {
    setShowConfirmDialog(false)
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">{children}</div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter sans enregistrer ?</AlertDialogTitle>
            <AlertDialogDescription>
              Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuer l'édition</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>
              Quitter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
