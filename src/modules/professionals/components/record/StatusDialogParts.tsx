import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { AlertDialogCancel } from '@/shared/ui/alert-dialog'

/** A refusal that belongs to no field, above the buttons (announced). */
export function DialogRefusal({ message }: { message: string | undefined }) {
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">{message}</AlertDescription>
    </Alert>
  )
}

/**
 * « Annuler », or « Fermer » when there is nothing left to confirm. While saving, the press is
 * cancelled (Radix then does not close the dialog) and focus stays on it.
 */
export function DialogCancel({ saving, nothingToConfirm }: { saving: boolean; nothingToConfirm: boolean }) {
  return (
    <AlertDialogCancel
      aria-disabled={saving || undefined}
      onClick={ignoreWhenInactive(saving)}
      className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
    >
      {t(nothingToConfirm ? 'common.close' : 'common.cancel')}
    </AlertDialogCancel>
  )
}
