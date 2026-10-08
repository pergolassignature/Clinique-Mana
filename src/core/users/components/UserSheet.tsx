import { useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import { FormActions } from '@/shared/components/FormActions'
import { initialsOf } from '@/shared/lib/format'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
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
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Badge } from '@/shared/ui/badge'
import { buttonVariants } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Label } from '@/shared/ui/label'
import { SegmentedControl } from '@/shared/ui/segmented-control'
import { Select } from '@/shared/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { Switch } from '@/shared/ui/switch'
import type { CatalogPermission, OrgUser } from '../api'
import { usePermissionCatalog, useSetPermissionState, useSetUserRole, useSetUserStatus, useUserOverrides } from '../hooks'
import {
  allowedOverrideStates,
  assignableRoles,
  groupPermissionsByModule,
  MANAGED_ROLES,
  overrideStateOf,
  roleGrants,
  type OverrideState,
} from '../permissions'
import { permissionGroupName } from './group-name'
import { LoadError, Loading } from './LoadState'

const SECTION_TITLE = 'text-base font-semibold tracking-tight'

/** What the caller may do with the target: everything, or nothing (and why). */
type Lock = null | 'self' | 'admin'

interface UserSheetProps {
  /** The user to show; null closes the sheet. */
  user: OrgUser | null
  onClose: () => void
  /**
   * Where focus goes once the sheet has closed (e.g. the row's name button). Without a Radix
   * trigger, the dialog would otherwise drop focus to <body>.
   */
  returnFocus?: () => void
}

/**
 * The sheet of one user (Paramètres → Utilisateurs et accès): role, account status and permission
 * overrides. Each change is saved at once (toast; the control waits while it saves). The guards
 * of the database are mirrored so the sheet never offers what the server would refuse; if it
 * refuses anyway, its French message is shown.
 */
export function UserSheet({ user, onClose, returnFocus }: UserSheetProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <Sheet open={user !== null} onOpenChange={(open) => !open && onClose()}>
      {user && (
        <SheetContent
          ref={contentRef}
          className="focus:outline-none"
          // The sheet itself takes focus (its name is read), not the first control: for one's own
          // account or a provider that is a read-only field, which would open with its text selected.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            contentRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus?.()
          }}
        >
          <UserSheetContent user={user} />
        </SheetContent>
      )}
    </Sheet>
  )
}

function UserSheetContent({ user }: { user: OrgUser }) {
  const caller = useReadyAccess()
  const callerIsAdmin = caller.role === 'admin'
  const lock: Lock = user.user_id === caller.user_id ? 'self' : user.role === 'admin' && !callerIsAdmin ? 'admin' : null
  const active = user.status === 'active'

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-3">
          <Avatar size="lg" aria-hidden>
            <AvatarFallback>{initialsOf(user.display_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              <SheetTitle className="truncate">{user.display_name}</SheetTitle>
              <Badge variant={active ? 'success' : 'error'}>{t(active ? 'settings.users.status.active' : 'settings.users.status.disabled')}</Badge>
            </div>
            <SheetDescription className="truncate">{user.email}</SheetDescription>
            <p className="text-xs text-muted-foreground">
              {t('settings.users.sheet.lastSignIn', {
                date: user.last_sign_in_at ? formatClinicDateTime(user.last_sign_in_at) : t('settings.users.never'),
              })}
            </p>
          </div>
        </div>
      </SheetHeader>
      <SheetBody className="space-y-6 pt-2">
        {lock && <LockNotice lock={lock} />}
        <RoleSection user={user} locked={lock !== null} callerIsAdmin={callerIsAdmin} />
        <StatusSection user={user} locked={lock !== null} callerIsAdmin={callerIsAdmin} />
        <PermissionsSection user={user} locked={lock !== null} callerIsAdmin={callerIsAdmin} />
      </SheetBody>
    </>
  )
}

function LockNotice({ lock }: { lock: Exclude<Lock, null> }) {
  return (
    <Alert>
      <Info aria-hidden />
      <AlertDescription>
        {lock === 'self' ? (
          <>
            {t('settings.users.sheet.selfBefore')}{' '}
            <Link to="/mon-compte" className="font-medium text-link underline underline-offset-2">
              {t('settings.users.sheet.selfLink')}
            </Link>
            .
          </>
        ) : (
          t('settings.users.sheet.adminOnly')
        )}
      </AlertDescription>
    </Alert>
  )
}

interface SectionProps {
  user: OrgUser
  /** The caller may not change this user at all (their own account, or an admin for a non-admin). */
  locked: boolean
  callerIsAdmin: boolean
}

// ── Rôle ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The role, in a small form with « Annuler / Enregistrer »: a closed select changes its value as
 * the arrow keys go through the options, so nothing is saved on change (decision #36). Making
 * someone admin, or removing the admin role, asks for confirmation first.
 */
function RoleSection({ user, locked, callerIsAdmin }: SectionProps) {
  const { can } = useAccess()
  const catalog = usePermissionCatalog()
  const setRole = useSetUserRole()
  const [draft, setDraft] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'promote' | 'demote' | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const isProvider = user.role === 'provider'
  const readOnly = locked || isProvider
  // A non-admin manager may assign only the roles whose defaults they hold, so their choices wait
  // for the catalogue (with its loading and error states).
  const needsCatalog = !callerIsAdmin && !readOnly
  const assignable = callerIsAdmin
    ? new Set<string>(MANAGED_ROLES)
    : catalog.data
      ? assignableRoles({ callerIsAdmin, callerCan: can, rolePermissions: catalog.data.rolePermissions })
      : new Set<string>()
  const value = draft ?? user.role ?? ''
  const dirty = draft !== null && draft !== user.role
  const options = [...MANAGED_ROLES, ...(user.role && !(MANAGED_ROLES as readonly string[]).includes(user.role) ? [user.role] : [])]
  useUnsavedChanges(dirty)

  // Either way the select then shows the saved role: the new one, or the old one after a refusal.
  const save = (role: string) => setRole.mutate({ userId: user.user_id, role }, { onSettled: () => setDraft(null) })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dirty || setRole.isPending || draft === null) return
    if (draft === 'admin') setConfirm('promote')
    else if (user.role === 'admin') setConfirm('demote')
    else save(draft)
  }

  const promoteBody = [
    t('settings.users.sheet.role.promote.body'),
    user.override_count === 1
      ? t('settings.users.sheet.role.promote.overridesOne')
      : user.override_count > 1
        ? t('settings.users.sheet.role.promote.overridesOther', { count: String(user.override_count) })
        : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={setRole.isPending || undefined}>
      <FormField
        label={t('settings.users.sheet.role.label')}
        help={isProvider ? t('settings.users.sheet.role.provider') : needsCatalog ? t('settings.users.sheet.role.managerLimit') : undefined}
        readOnly={readOnly}
      >
        {(field) => (
          <Select
            {...field}
            ref={selectRef}
            value={value}
            placeholder={user.role === null ? t('settings.users.noRole') : undefined}
            onChange={(event) => {
              // Ignored while saving: the controlled value snaps back (no `disabled`, so focus stays).
              if (!setRole.isPending) setDraft(event.target.value)
            }}
          >
            {options.map((role) => (
              <option key={role} value={role} disabled={role !== user.role && !assignable.has(role)}>
                {roleLabel(role, role === user.role ? user.role_name : undefined)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {needsCatalog && catalog.isPending && (
        <div className="mt-2">
          <Loading />
        </div>
      )}
      {needsCatalog && catalog.isError && !catalog.data && (
        <div className="mt-2">
          <LoadError message={t('settings.users.sheet.role.loadError')} onRetry={() => void catalog.refetch()} retrying={catalog.isFetching} />
        </div>
      )}
      {!readOnly && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <FormActions onCancel={() => setDraft(null)} onReset={() => selectRef.current?.focus()} dirty={dirty} pending={setRole.isPending} />
        </div>
      )}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent
          // Opened without a trigger: focus goes back to the select, whatever the answer.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            selectRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'promote' ? t('settings.users.sheet.role.promote.title', { name: user.display_name }) : t('settings.users.sheet.role.demote.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'promote'
                ? promoteBody
                : t('settings.users.sheet.role.demote.body', { name: user.display_name, role: draft ? roleLabel(draft) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => draft !== null && save(draft)}>
              {confirm === 'promote' ? t('settings.users.sheet.role.promote.confirm') : t('settings.users.sheet.role.demote.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}


// ── Statut ──────────────────────────────────────────────────────────────────────────────────────

function StatusSection({ user, locked, callerIsAdmin }: SectionProps) {
  const setStatus = useSetUserStatus()
  const [confirming, setConfirming] = useState(false)
  const switchRef = useRef<HTMLButtonElement>(null)
  const switchId = useId()
  const helpId = useId()
  // Only an admin re-enables an account.
  const reenableBlocked = user.status === 'disabled' && !callerIsAdmin
  const checked = setStatus.isPending ? setStatus.variables.status === 'active' : user.status === 'active'

  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={switchId}>{t('settings.users.sheet.status.label')}</Label>
        <Switch
          ref={switchRef}
          id={switchId}
          checked={checked}
          readOnly={locked || reenableBlocked}
          aria-disabled={setStatus.isPending || undefined}
          aria-describedby={reenableBlocked && !locked ? helpId : undefined}
          className={cn(setStatus.isPending && 'cursor-progress')}
          onCheckedChange={(next) => {
            if (setStatus.isPending) return
            if (next) setStatus.mutate({ userId: user.user_id, status: 'active' })
            else setConfirming(true)
          }}
        />
      </div>
      {reenableBlocked && !locked && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {t('settings.users.sheet.status.reenableAdminOnly')}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          // Opened without a trigger: send focus back to the switch, whatever the answer.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            switchRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.users.sheet.status.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.users.sheet.status.confirmBody', { name: user.display_name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => setStatus.mutate({ userId: user.user_id, status: 'disabled' })}
            >
              {t('settings.users.sheet.status.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ── Permissions ─────────────────────────────────────────────────────────────────────────────────

function PermissionsSection({ user, locked, callerIsAdmin }: SectionProps) {
  const titleId = useId()
  const { can, access } = useAccess()
  const catalog = usePermissionCatalog()
  const isAdmin = user.role === 'admin'
  const overrides = useUserOverrides(isAdmin ? undefined : user.user_id)

  let body
  if (isAdmin) {
    body = <p className="text-sm text-muted-foreground">{t('settings.users.sheet.permissions.admin')}</p>
  } else if (catalog.isPending || overrides.isPending) {
    body = <Loading />
  } else if ((catalog.isError && !catalog.data) || (overrides.isError && !overrides.data)) {
    body = (
      <LoadError
        message={t('settings.users.sheet.permissions.loadError')}
        retrying={catalog.isFetching || overrides.isFetching}
        onRetry={() => {
          if (catalog.isError) void catalog.refetch()
          if (overrides.isError) void overrides.refetch()
        }}
      />
    )
  } else {
    const roleSet = roleGrants(user.role, catalog.data.rolePermissions)
    const groups = groupPermissionsByModule(catalog.data.permissions, catalog.data.modules, access?.modules ?? [])
    body = (
      <div className="space-y-5">
        <p className="text-xs text-muted-foreground">
          {t('settings.users.sheet.permissions.description')}
          {!callerIsAdmin && !locked && <> {t('settings.users.sheet.permissions.managerLimit')}</>}
        </p>
        {groups.map((group) => (
          <div key={group.key} className="space-y-3">
            <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{permissionGroupName(group)}</h4>
            {group.permissions.map((permission) => {
              const current = overrideStateOf(permission.key, overrides.data)
              return (
                <PermissionRow
                  key={permission.key}
                  userId={user.user_id}
                  permission={permission}
                  byRole={roleSet.has(permission.key)}
                  current={current}
                  allowed={allowedOverrideStates({ callerIsAdmin, callerCan: can, permissionKey: permission.key, current })}
                  locked={locked}
                />
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  return (
    <section aria-labelledby={titleId} className="space-y-2 border-t border-border pt-5">
      <h3 id={titleId} className={SECTION_TITLE}>
        {t('settings.users.sheet.permissions.title')}
      </h3>
      {body}
    </section>
  )
}

interface PermissionRowProps {
  userId: string
  permission: CatalogPermission
  /** Whether the user's role gives it by default. */
  byRole: boolean
  current: OverrideState
  allowed: Set<OverrideState>
  locked: boolean
}

/**
 * One permission: its description and a toggle group « Selon le rôle (Oui|Non) » / « Accordée » /
 * « Retirée ». The arrow keys only move focus; Enter, Space or a click chooses and saves at once
 * (optimistic, with a toast). While it saves, the group ignores other choices.
 */
function PermissionRow({ userId, permission, byRole, current, allowed, locked }: PermissionRowProps) {
  const labelId = useId()
  const hintId = useId()
  const save = useSetPermissionState(userId)
  // A manager who lacks the permission cannot clear its revoke (the role default would give it back).
  const revokeStays = !locked && current === 'revoked' && !allowed.has('role')
  const label = (state: OverrideState) =>
    state === 'role'
      ? t('settings.users.sheet.permissions.byRole', {
          value: t(byRole ? 'settings.users.sheet.permissions.yes' : 'settings.users.sheet.permissions.no'),
        })
      : t(`settings.users.sheet.permissions.${state}`)
  const states: OverrideState[] = ['role', 'granted', 'revoked']

  return (
    <div className="min-w-0">
      <p id={labelId} className="mb-1.5 text-sm text-foreground">
        {permission.description}
      </p>
      <SegmentedControl
        aria-labelledby={labelId}
        aria-describedby={revokeStays ? hintId : undefined}
        options={states.map((state) => ({ value: state, label: label(state), disabled: state !== current && !allowed.has(state) }))}
        value={current}
        disabled={locked}
        pending={save.isPending}
        onValueChange={(state) => save.mutate({ key: permission.key, state, label: permission.description })}
      />
      {revokeStays && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {t('settings.users.sheet.permissions.revokeHint')}
        </p>
      )}
    </div>
  )
}
