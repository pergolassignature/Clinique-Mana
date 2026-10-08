import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import type { OrgRole } from '@/core/access/api'
import { moduleErrorMessage } from '@/core/modules/errors'
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
import { toast } from '@/shared/ui/sonner'
import { isRoleMissing, useDeleteRole } from '../hooks'

interface DeleteRoleDialogProps {
  /** The custom role to delete; null closes the dialog. */
  role: OrgRole | null
  onClose: () => void
  /** Where focus goes once the dialog has closed (it has no trigger). */
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Supprimer le rôle ? »: the database decides whether nobody has it; if someone does, its
 * message (« Ce rôle est attribué à n personne(s). ») shows here and the dialog stays open. A role
 * already deleted by another manager (« Ce rôle n'existe plus. ») closes it with that message as a
 * toast (the hook refetches the roles). While deleting, it cannot be closed.
 */
export function DeleteRoleDialog({ role, onClose, onCloseAutoFocus }: DeleteRoleDialogProps) {
  const remove = useDeleteRole()
  // The refusal shown, for the role it concerns: computed once (moduleErrorMessage may report to
  // Sentry), and never shown for another role opened later.
  const [refusal, setRefusal] = useState<{ role: string; message: string } | null>(null)

  const close = () => {
    remove.reset()
    setRefusal(null)
    onClose()
  }

  const changeOpen = (open: boolean) => {
    if (open || remove.isPending) return
    close()
  }

  const confirm = (target: OrgRole) => {
    setRefusal(null)
    remove.mutate(
      { role: target.key, name: target.name },
      {
        onSuccess: close,
        onError: (error) => {
          const message = moduleErrorMessage(error, t('common.errors.generic'), 'settings')
          if (isRoleMissing(error)) {
            toast.error(message)
            close()
          } else {
            setRefusal({ role: target.key, message })
          }
        },
      },
    )
  }

  return (
    <AlertDialog open={role !== null} onOpenChange={changeOpen}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        {role && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('settings.users.roleDelete.title', { name: role.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t('settings.users.roleDelete.body')}</AlertDialogDescription>
            </AlertDialogHeader>
            {refusal?.role === role.key && (
              <Alert variant="destructive" role="alert">
                <CircleAlert aria-hidden />
                <AlertDescription className="text-foreground">{refusal.message}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              {/* Radix focuses Cancel first: keeping the role is the safe default. */}
              <AlertDialogCancel
                aria-disabled={remove.isPending || undefined}
                onClick={ignoreWhenInactive(remove.isPending)}
                className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {t('common.cancel')}
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                aria-disabled={remove.isPending || undefined}
                onClick={ignoreWhenInactive(remove.isPending, () => confirm(role))}
                className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
              >
                {remove.isPending ? t('settings.users.roleDelete.deleting') : t('settings.users.roleDelete.confirm')}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
