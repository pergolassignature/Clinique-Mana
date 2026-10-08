import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
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
import type { OrgRole } from '../api'
import { useDeleteRole } from '../hooks'

interface DeleteRoleDialogProps {
  /** The custom role to delete; null closes the dialog. */
  role: OrgRole | null
  onClose: () => void
  /** Where focus goes once the dialog has closed (it has no trigger). */
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Supprimer le rôle ? »: the database decides whether nobody has it; if someone does, its
 * message (« Ce rôle est attribué à n personne(s). ») shows here and the dialog stays open. While
 * deleting, it cannot be closed.
 */
export function DeleteRoleDialog({ role, onClose, onCloseAutoFocus }: DeleteRoleDialogProps) {
  const remove = useDeleteRole()

  const changeOpen = (open: boolean) => {
    if (open || remove.isPending) return
    remove.reset()
    onClose()
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
            {remove.isError && (
              <Alert variant="destructive" role="alert">
                <CircleAlert aria-hidden />
                <AlertDescription className="text-foreground">{moduleErrorMessage(remove.error, t('common.errors.generic'), 'settings')}</AlertDescription>
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
                onClick={ignoreWhenInactive(remove.isPending, () =>
                  remove.mutate(
                    { role: role.key, name: role.name },
                    {
                      onSuccess: () => {
                        remove.reset()
                        onClose()
                      },
                    },
                  ),
                )}
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
