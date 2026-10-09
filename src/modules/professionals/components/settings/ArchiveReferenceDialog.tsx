import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
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
import type { ReferenceKind } from '../../api/catalog'
import { useSetReferenceActive } from '../../hooks/use-reference-mutations'

/** The row a confirmation acts on: an active row is archived, an archived one restored. */
export interface ArchiveTarget {
  id: string
  name: string
  isActive: boolean
}

interface ArchiveReferenceDialogProps {
  kind: ReferenceKind
  open: boolean
  /** Kept while the dialog closes, so its text does not change. */
  row: ArchiveTarget | null
  /** What archiving changes (who uses the row); restoring says the row can be chosen again. */
  archiveBody: string
  onOpenChange: (open: boolean) => void
  /** Where focus goes once the dialog has closed (it has no trigger). */
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Archiver « nom » ? » / « Restaurer « nom » ? ». Archiving keeps the row on the files that use
 * it but takes it out of the choices; the database refuses what it must (a system row, a category
 * with active titles…) and its message shows here, the dialog staying open. While it saves, it
 * cannot be closed. Radix focuses « Annuler » first: keeping things as they are is the safe default.
 */
export function ArchiveReferenceDialog({ kind, open, row, archiveBody, onOpenChange, onCloseAutoFocus }: ArchiveReferenceDialogProps) {
  // The refusal shown, for the row it concerns (never shown for another row opened later).
  const [refusal, setRefusal] = useState<{ id: string; message: string } | null>(null)
  const setActive = useSetReferenceActive({
    onErrorMessage: (message) => {
      if (row) setRefusal({ id: row.id, message })
    },
  })
  const pending = setActive.isPending

  const changeOpen = (next: boolean) => {
    if (pending) return
    if (!next) {
      setActive.reset()
      setRefusal(null)
    }
    onOpenChange(next)
  }

  const archiving = row?.isActive ?? true
  const prefix = archiving ? 'archive' : 'restore'

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        {row && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`modules.professionals.settings.list.${prefix}.title`, { name: row.name })}</AlertDialogTitle>
              <AlertDialogDescription>
                {archiving ? archiveBody : t('modules.professionals.settings.list.restore.body', { name: row.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {refusal?.id === row.id && (
              <Alert variant="destructive" role="alert">
                <CircleAlert aria-hidden />
                <AlertDescription className="text-foreground">{refusal.message}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel
                aria-disabled={pending || undefined}
                // While saving, the press is cancelled (Radix then does not close the dialog).
                onClick={ignoreWhenInactive(pending)}
                className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {t('common.cancel')}
              </AlertDialogCancel>
              <Button
                type="button"
                variant={archiving ? 'destructive' : 'default'}
                aria-disabled={pending || undefined}
                onClick={ignoreWhenInactive(pending, () => {
                  setRefusal(null)
                  setActive.mutate(
                    { kind, id: row.id, active: !archiving },
                    {
                      onSuccess: () => {
                        setActive.reset()
                        onOpenChange(false)
                      },
                    },
                  )
                })}
                className={cn(softDisabledClasses, archiving ? 'aria-disabled:hover:bg-destructive' : 'aria-disabled:hover:bg-primary')}
              >
                {t(`modules.professionals.settings.list.${prefix}.${pending ? 'pending' : 'confirm'}`)}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
