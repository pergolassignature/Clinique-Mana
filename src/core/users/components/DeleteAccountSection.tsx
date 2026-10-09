import { useId, useRef, useState, type FormEvent } from 'react'
import { CircleAlert, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
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
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { isAccountRemovedError, type OrgUser } from '../api'
import { useDeleteUserAccount, userAdminErrorMessage } from '../hooks'

/** Whether the typed text is the person's address (case and outer spaces ignored). */
function confirmsEmail(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase()
}

/**
 * « Supprimer le compte » at the bottom of the user sheet (users.manage; the sheet hides it for
 * one's own account and, for a non-admin manager, an admin's). Offered only on a disabled account:
 * on an active one the button is inactive and says « Désactivez d'abord le compte. ». The
 * confirmation states what goes and what stays, and asks for the person's address, typed (as
 * GitHub does), before its button « Supprimer le compte de {nom} » acts. The server decides the
 * rest (a module may refuse, e.g. an account linked to a professional file): its refusal shows in
 * the dialog, which stays open.
 */
export function DeleteAccountSection({ user }: { user: OrgUser }) {
  const { can } = useAccess()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const hintId = useId()
  if (!can('users.manage')) return null
  const active = user.status === 'active'

  return (
    <section aria-labelledby={titleId} className="space-y-2 border-t border-border pt-5">
      <h3 id={titleId} className="text-base font-semibold tracking-tight">
        {t('settings.users.sheet.delete.title')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('settings.users.sheet.delete.description', { name: user.display_name })}</p>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        aria-disabled={active || undefined}
        aria-describedby={active ? hintId : undefined}
        className={cn(softDisabledClasses, 'max-w-full text-destructive aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
        onClick={ignoreWhenInactive(active, () => setOpen(true))}
      >
        <Trash2 aria-hidden />
        <span className="truncate">{t('settings.users.sheet.delete.button', { name: user.display_name })}</span>
      </Button>
      {active && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {t('settings.users.sheet.delete.disableFirst')}
        </p>
      )}
      <DeleteAccountDialog
        user={user}
        open={open}
        onClose={() => setOpen(false)}
        onCloseAutoFocus={(event) => {
          // Opened without a trigger: back to the button while it is still there (after a deletion
          // the sheet closes and sends focus back to the list itself).
          event.preventDefault()
          if (buttonRef.current?.isConnected) buttonRef.current.focus()
        }}
      />
    </section>
  )
}

interface DeleteAccountDialogProps {
  user: OrgUser
  open: boolean
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

function DeleteAccountDialog({ user, open, onClose, onCloseAutoFocus }: DeleteAccountDialogProps) {
  const remove = useDeleteUserAccount()
  const [typed, setTyped] = useState('')
  // Computed once per failure (userAdminErrorMessage may report to Sentry).
  const [refusal, setRefusal] = useState<string | null>(null)
  const matches = confirmsEmail(typed, user.email)
  const inactive = !matches || remove.isPending

  const close = () => {
    remove.reset()
    setTyped('')
    setRefusal(null)
    onClose()
  }

  const confirm = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (inactive) return
    setRefusal(null)
    remove.mutate(
      { userId: user.user_id, name: user.display_name },
      {
        onSuccess: close,
        onError: (error) => {
          // Only Auth failed: she has left the app (the hook's warning offers « Réessayer »).
          if (isAccountRemovedError(error)) close()
          else setRefusal(userAdminErrorMessage(error))
        },
      },
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !remove.isPending && close()}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <form onSubmit={confirm} noValidate className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.users.sheet.delete.confirmTitle', { name: user.display_name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.users.sheet.delete.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="inline font-medium">{t('settings.users.sheet.delete.removedLabel')} : </dt>
              <dd className="inline">{t('settings.users.sheet.delete.removed')}</dd>
            </div>
            <div>
              <dt className="inline font-medium">{t('settings.users.sheet.delete.keptLabel')} : </dt>
              <dd className="inline">{t('settings.users.sheet.delete.kept')}</dd>
            </div>
          </dl>
          <FormField label={t('settings.users.sheet.delete.typeLabel', { email: user.email })}>
            {(field) => (
              <Input
                {...field}
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            )}
          </FormField>
          {refusal !== null && (
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden />
              <AlertDescription className="text-foreground">{refusal}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            {/* Radix focuses Cancel first: keeping the account is the safe default. */}
            <AlertDialogCancel
              type="button"
              aria-disabled={remove.isPending || undefined}
              onClick={ignoreWhenInactive(remove.isPending)}
              className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
            >
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              aria-disabled={inactive || undefined}
              onClick={ignoreWhenInactive(inactive)}
              className={cn(softDisabledClasses, 'max-w-full aria-disabled:hover:bg-destructive', remove.isPending && 'cursor-progress')}
            >
              <span className="truncate">
                {remove.isPending ? t('settings.users.sheet.delete.deleting') : t('settings.users.sheet.delete.button', { name: user.display_name })}
              </span>
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
