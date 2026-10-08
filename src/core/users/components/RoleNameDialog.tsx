import { useRef, type RefObject } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import type { OrgRole } from '@/core/access/api'
import { useAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import { moduleErrorMessage, rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { isRoleMissing, useCreateRole, useRenameRole } from '../hooks'
import { foldRoleName, holdsRoleDefaults, normalizeRoleName, orderRoles, type RolePermission } from '../permissions'

/** The database's limit (roles_name_check), in characters (code points, as `char_length`). */
const NAME_MAX = 60

const schema = z.object({
  name: z
    .string()
    .transform(normalizeRoleName)
    .refine((name) => name !== '', { error: t('settings.users.roleDialog.validation.nameRequired') })
    .refine((name) => [...name].length <= NAME_MAX, { error: t('settings.users.roleDialog.validation.nameTooLong') }),
  copyFrom: z.string(),
})
type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

/**
 * The field a refusal of create_role or rename_role goes on, from its hint: the copy source's
 * (HINT copy_from: the caller lacks one of its permissions; role_missing: it was deleted
 * meanwhile), else the name (every other P0001 is about it). Null for anything else: an alert.
 */
function refusalField(error: unknown): 'name' | 'copyFrom' | null {
  if (rpcErrorCode(error) !== 'P0001') return null
  const hint = rpcErrorHint(error)
  return hint === 'copy_from' || hint === 'role_missing' ? 'copyFrom' : 'name'
}

interface RoleNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The custom role to rename; without it, « Nouveau rôle ». */
  role?: OrgRole
  /** The clinic's roles: the duplicates checked here, the roles to copy from. */
  roles: OrgRole[]
  rolePermissions: RolePermission[]
  /** Where focus goes once the dialog has closed (it has no trigger). */
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Nouveau rôle » (a name, and optionally the role whose defaults it starts from) and
 * « Renommer le rôle » (the name). The form lives inside the content, so each opening starts
 * afresh. While it saves the dialog cannot be closed, so its outcome is always seen: success
 * closes it (toast), a refusal stays in it, on the field it concerns. Renaming a role another
 * manager has just deleted (« Ce rôle n'existe plus. ») closes it with that message as a toast.
 */
export function RoleNameDialog({ open, onOpenChange, role, roles, rolePermissions, onCloseAutoFocus }: RoleNameDialogProps) {
  const create = useCreateRole()
  const rename = useRenameRole()
  const pending = create.isPending || rename.isPending
  const nameRef = useRef<HTMLInputElement | null>(null)

  const changeOpen = (next: boolean) => {
    if (pending) return
    if (!next) {
      create.reset()
      rename.reset()
    }
    onOpenChange(next)
  }

  const save = async ({ name, copyFrom }: FormOutput) => {
    if (role) {
      try {
        await rename.mutateAsync({ role: role.key, name })
      } catch (error) {
        if (!isRoleMissing(error)) throw error
        // The roles are refetched (the hook) and the role has gone: nothing left to rename.
        toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
        rename.reset()
      }
    } else {
      await create.mutateAsync({ name, copyFrom: copyFrom === '' ? null : copyFrom })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameRef.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t(role ? 'settings.users.roleDialog.renameTitle' : 'settings.users.roleDialog.createTitle')}</DialogTitle>
          <DialogDescription>{t(role ? 'settings.users.roleDialog.renameDescription' : 'settings.users.roleDialog.createDescription')}</DialogDescription>
        </DialogHeader>
        <RoleNameForm role={role} roles={roles} rolePermissions={rolePermissions} nameRef={nameRef} pending={pending} onSave={save} />
      </DialogContent>
    </Dialog>
  )
}

interface RoleNameFormProps {
  role?: OrgRole
  roles: OrgRole[]
  rolePermissions: RolePermission[]
  nameRef: RefObject<HTMLInputElement | null>
  pending: boolean
  /** Saves; rejects with the database error. */
  onSave: (values: FormOutput) => Promise<void>
}

function RoleNameForm({ role, roles, rolePermissions, nameRef, pending, onSave }: RoleNameFormProps) {
  const { access, can } = useAccess()
  const callerIsAdmin = access?.role === 'admin'
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { name: role?.name ?? '', copyFrom: '' },
  })
  const { errors, isDirty } = form.formState
  const { ref: registerNameRef, ...nameField } = form.register('name')
  // The refusal that belongs to no field (already through moduleErrorMessage).
  const alert = errors.root?.server?.message

  const submit = form.handleSubmit(async (values) => {
    // The duplicate is caught here; the database still decides (another manager may have just
    // used the name, and it compares more strictly).
    if (roles.some((r) => r.key !== role?.key && foldRoleName(r.name) === foldRoleName(values.name))) {
      form.setError('name', { message: t('settings.users.roleDialog.validation.nameTaken') }, { shouldFocus: true })
      return
    }
    try {
      await onSave(values)
    } catch (error) {
      const message = moduleErrorMessage(error, t('common.errors.generic'), 'settings')
      const field = refusalField(error)
      // The copy source was deleted meanwhile: it leaves the list (refetched), so the choice goes too.
      if (isRoleMissing(error)) form.setValue('copyFrom', '', { shouldDirty: true })
      if (field) form.setError(field, { message }, { shouldFocus: true })
      else form.setError('root.server', { message })
    }
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-3.5">
      <FormField label={t('settings.users.roleDialog.name')} required error={errors.name?.message}>
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
      {!role && (
        <FormField
          label={t('settings.users.roleDialog.copyFrom')}
          help={callerIsAdmin ? t('settings.users.roleDialog.copyHelp') : `${t('settings.users.roleDialog.copyHelp')} ${t('settings.users.roleDialog.copyManagerLimit')}`}
          error={errors.copyFrom?.message}
        >
          {(field) => (
            <Select {...field} {...form.register('copyFrom')}>
              <option value="">{t('settings.users.roleDialog.copyNone')}</option>
              {orderRoles(roles).map((r) => (
                <option key={r.key} value={r.key} disabled={!holdsRoleDefaults({ callerIsAdmin, callerCan: can, role: r.key, rolePermissions })}>
                  {roleLabel(r.key, r.name)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
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
            // While saving, the press is cancelled (Radix then does not close the dialog).
            onClick={ignoreWhenInactive(pending)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
        </DialogClose>
        {/* Outline until something is typed (brand rule), like the cards' « Enregistrer ». */}
        <SaveButton
          pending={pending}
          disabled={!isDirty}
          variant={isDirty || pending ? 'default' : 'outline'}
          label={t(role ? 'settings.users.roleDialog.rename' : 'settings.users.roleDialog.create')}
          pendingLabel={t(role ? 'settings.users.roleDialog.renaming' : 'settings.users.roleDialog.creating')}
        />
      </DialogFooter>
    </form>
  )
}
