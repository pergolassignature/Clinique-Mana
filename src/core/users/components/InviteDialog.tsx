import { useRef, useState, type Ref, type RefObject } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useOrgRoles } from '@/core/access/org-roles'
import { roleLabel } from '@/core/access/roles'
import { FunctionCallError } from '@/core/supabase/functions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { emailSchema } from '@/shared/lib/email'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
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
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { useInviteStaff, useRoleDefaults, userAdminErrorMessage } from '../hooks'
import { assignableRoles, orderRoles } from '../permissions'

/** staff_invitations' checks: the name 1–80 characters, the address trimmed and lowercase. */
const schema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, { error: t('settings.users.invite.validation.nameRequired') })
    .max(80, { error: t('settings.users.invite.validation.nameTooLong') }),
  email: emailSchema(t('settings.users.invite.validation.emailInvalid')).toLowerCase(),
  role: z.string().min(1, { error: t('settings.users.invite.validation.roleRequired') }),
})
type FormInput = z.input<typeof schema>
type FormValues = z.output<typeof schema>

/** `staff-invite`'s refused field (`field` of a 400) → the form's field and its message. */
const FUNCTION_FIELDS = {
  email: { name: 'email', message: () => t('settings.users.invite.validation.emailInvalid') },
  display_name: { name: 'displayName', message: () => t('settings.users.invite.validation.nameInvalid') },
  role: { name: 'role', message: () => t('settings.users.invite.validation.roleRequired') },
} as const satisfies Record<string, { name: keyof FormValues; message: () => string }>
const isFunctionField = (field: string | undefined): field is keyof typeof FUNCTION_FIELDS =>
  field !== undefined && Object.hasOwn(FUNCTION_FIELDS, field)

/**
 * « Inviter » (users.manage) and its dialog: Nom, Courriel, Rôle. The roles offered are those the
 * caller may give (`assignableRoles`: never Professionnel; Administrateur by an admin only; for a
 * non-admin manager, the roles whose permissions she holds), as `create_staff_invitation` checks
 * again. Inviting an administrator asks for confirmation first (decision #36). While sending, the
 * dialog cannot be closed; success closes it with a toast (a warning when only the email failed,
 * the hook), and a refusal stays in it.
 */
export function InviteDialog({ triggerRef }: { triggerRef?: Ref<HTMLButtonElement> }) {
  const [open, setOpen] = useState(false)
  const invite = useInviteStaff()
  const nameRef = useRef<HTMLInputElement | null>(null)

  const changeOpen = (next: boolean) => {
    if (invite.isPending) return
    if (!next) invite.reset()
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button ref={triggerRef}>{t('settings.users.invite.button')}</Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('settings.users.invite.title')}</DialogTitle>
          <DialogDescription>{t('settings.users.invite.description')}</DialogDescription>
        </DialogHeader>
        <InviteForm
          nameRef={nameRef}
          pending={invite.isPending}
          onSend={async (values) => {
            await invite.mutateAsync(values)
            setOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

interface InviteFormProps {
  nameRef: RefObject<HTMLInputElement | null>
  pending: boolean
  /** Sends; rejects with the refusal. */
  onSend: (values: FormValues) => Promise<void>
}

function InviteForm({ nameRef, pending, onSend }: InviteFormProps) {
  const { access, can } = useAccess()
  const callerIsAdmin = access?.role === 'admin'
  const roles = useOrgRoles()
  // An admin may give any role: only a non-admin manager's choices need the defaults (hold rule).
  const defaults = useRoleDefaults({ enabled: !callerIsAdmin })
  const [confirmAdmin, setConfirmAdmin] = useState<FormValues | null>(null)
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: '', email: '', role: '' },
  })
  const { errors, isDirty } = form.formState
  const { ref: registerNameRef, ...nameField } = form.register('displayName')
  const alert = errors.root?.server?.message

  // An admin's choices need the roles only; a non-admin manager's also the defaults (hold rule).
  const needed = callerIsAdmin ? [roles] : [roles, defaults]
  const failed = needed.filter((q) => q.isError && !q.data)
  const allowed =
    roles.data && (callerIsAdmin || defaults.data)
      ? assignableRoles({ callerIsAdmin, callerCan: can, roles: roles.data, rolePermissions: defaults.data ?? [] })
      : null
  const choices = allowed && roles.data ? orderRoles(roles.data).filter((r) => allowed.has(r.key)) : null

  const send = async (values: FormValues) => {
    try {
      await onSend(values)
    } catch (error) {
      // staff-invite's rules can be stricter than the form's (its mailbox rule): it names the field.
      const field = error instanceof FunctionCallError && error.code === 'invalid_request' ? error.field : undefined
      if (isFunctionField(field)) {
        const { name, message } = FUNCTION_FIELDS[field]
        form.setError(name, { message: message() }, { shouldFocus: true })
      } else {
        form.setError('root.server', { message: userAdminErrorMessage(error) })
      }
    }
  }

  const submit = form.handleSubmit(async (values) => {
    if (values.role === 'admin') setConfirmAdmin(values)
    else await send(values)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-3.5" aria-busy={pending || undefined}>
      <FormField label={t('settings.users.invite.name')} required error={errors.displayName?.message}>
        {(field) => (
          <Input
            {...field}
            {...nameField}
            ref={(element) => {
              registerNameRef(element)
              nameRef.current = element
            }}
            autoComplete="off"
          />
        )}
      </FormField>
      <FormField label={t('settings.users.invite.email')} required error={errors.email?.message}>
        {(field) => <Input {...field} {...form.register('email')} type="email" autoComplete="off" />}
      </FormField>
      <FormField
        label={t('settings.users.invite.role')}
        required
        help={callerIsAdmin ? undefined : t('settings.users.invite.roleManagerLimit')}
        error={errors.role?.message}
      >
        {(field) => (
          <Select {...field} {...form.register('role')} placeholder={t('settings.users.invite.rolePlaceholder')}>
            {choices?.map((r) => (
              <option key={r.key} value={r.key}>
                {roleLabel(r.key, r.name)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {failed.length > 0 ? (
        <LoadError
          message={t('settings.users.invite.rolesLoadError')}
          onRetry={() => failed.forEach((q) => void q.refetch())}
          retrying={failed.some((q) => q.isFetching)}
        />
      ) : (
        choices === null && <Loading />
      )}
      {alert && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{alert}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending || undefined}
            // While sending, the press is cancelled (Radix then does not close the dialog).
            onClick={ignoreWhenInactive(pending)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <SaveButton
          pending={pending}
          disabled={!isDirty}
          variant={isDirty || pending ? 'default' : 'outline'}
          label={t('settings.users.invite.submit')}
          pendingLabel={t('settings.users.invite.submitting')}
        />
      </DialogFooter>
      <AlertDialog open={confirmAdmin !== null} onOpenChange={(next) => !next && setConfirmAdmin(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.users.invite.adminConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.users.invite.adminConfirm.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmAdmin && void send(confirmAdmin)}>{t('settings.users.invite.adminConfirm.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
