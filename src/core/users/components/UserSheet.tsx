import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import type { CatalogPermission } from '@/core/access/api'
import { usePermissionCatalog } from '@/core/access/catalog'
import { useOrgRoles } from '@/core/access/org-roles'
import { roleLabel } from '@/core/access/roles'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
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
import { Button, buttonVariants } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { Switch } from '@/shared/ui/switch'
import type { OrgUser } from '../api'
import {
  useIsSavingPermission,
  useResetPermissions,
  useRoleDefaults,
  useSetPermissionState,
  useSetUserRole,
  useSetUserStatus,
  useUserOverrides,
} from '../hooks'
import {
  assignableRoles,
  canResetOverrides,
  canTogglePermission,
  effectivePermission,
  groupPermissionsByModule,
  MANAGED_ROLES,
  orderRoles,
  PROVIDER_ROLE,
  roleGrants,
  stateForSwitch,
  type PermissionOverride,
} from '../permissions'
import { permissionGroupName } from './group-name'

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
 * switches (the role default, or an exception; decision #39). Each change is saved at once (toast; the control waits while it saves). The guards
 * of the database are mirrored so the sheet never offers what the server would refuse; if it
 * refuses anyway, its French message is shown.
 */
export function UserSheet({ user, onClose, returnFocus }: UserSheetProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  // The role form's unsaved draft: closing the sheet (X, Escape, overlay) asks first. The sheet's
  // own check, not the page guard (unsaved-changes-context.ts): only this form matters here.
  const [roleDirty, setRoleDirty] = useState(false)
  const [askLeave, setAskLeave] = useState(false)
  const focusAfterStay = useRef<HTMLElement | null>(null)
  const leaving = useRef(false)

  const requestClose = () => {
    if (!roleDirty) return onClose()
    focusAfterStay.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setAskLeave(true)
  }

  return (
    <Sheet open={user !== null} onOpenChange={(open) => !open && requestClose()}>
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
          <UserSheetContent user={user} onRoleDirtyChange={setRoleDirty} />
          <AlertDialog open={askLeave} onOpenChange={setAskLeave}>
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                // « Quitter »: the sheet closes and sends focus back to the row itself.
                event.preventDefault()
                if (leaving.current) {
                  leaving.current = false
                  return
                }
                const target = focusAfterStay.current?.isConnected ? focusAfterStay.current : contentRef.current
                target?.focus()
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>{t('common.unsaved.title')}</AlertDialogTitle>
                <AlertDialogDescription>{t('common.unsaved.body')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* Radix focuses Cancel first: « Rester » is the safe default. */}
                <AlertDialogCancel>{t('common.unsaved.stay')}</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={() => {
                    leaving.current = true
                    setAskLeave(false)
                    onClose()
                  }}
                >
                  {t('common.unsaved.leave')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SheetContent>
      )}
    </Sheet>
  )
}

function UserSheetContent({ user, onRoleDirtyChange }: { user: OrgUser; onRoleDirtyChange: (dirty: boolean) => void }) {
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
        <RoleSection user={user} locked={lock !== null} callerIsAdmin={callerIsAdmin} onDirtyChange={onRoleDirtyChange} />
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
 * someone admin, or removing the admin role, asks for confirmation first. The choices are the base
 * roles but provider, then the clinic's custom roles once loaded (decision #40).
 */
function RoleSection({ user, locked, callerIsAdmin, onDirtyChange }: SectionProps & { onDirtyChange: (dirty: boolean) => void }) {
  const { can } = useAccess()
  const roles = useOrgRoles()
  const defaults = useRoleDefaults()
  const setRole = useSetUserRole()
  const [draft, setDraft] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'promote' | 'demote' | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const isProvider = user.role === 'provider'
  const readOnly = locked || isProvider
  // A non-admin manager may assign only the roles whose defaults they hold, so their choices wait
  // for the clinic's defaults (with their loading and error states).
  const needsDefaults = !callerIsAdmin && !readOnly
  const choices: string[] = roles.data ? orderRoles(roles.data.filter((r) => r.key !== PROVIDER_ROLE)).map((r) => r.key) : [...MANAGED_ROLES]
  const options = [...choices, ...(user.role && !choices.includes(user.role) ? [user.role] : [])]
  const names = new Map(roles.data?.map((r) => [r.key, r.name]))
  const label = (role: string) => roleLabel(role, names.get(role) ?? (role === user.role ? user.role_name : undefined))
  const assignable = callerIsAdmin
    ? new Set(choices)
    : defaults.data
      ? assignableRoles({ callerIsAdmin, callerCan: can, roles: choices.map((key) => ({ key })), rolePermissions: defaults.data })
      : new Set<string>()
  const failed = [roles, ...(needsDefaults ? [defaults] : [])].filter((q) => q.isError && !q.data)
  const value = draft ?? user.role ?? ''
  const dirty = draft !== null && draft !== user.role
  // The page guard covers leaving the page (links, reload); the sheet asks on close (onDirtyChange).
  useUnsavedChanges(dirty)
  // Layout effect: the sheet knows at once, even for an Escape pressed right after a change.
  useLayoutEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

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
        help={isProvider ? t('settings.users.sheet.role.provider') : needsDefaults ? t('settings.users.sheet.role.managerLimit') : undefined}
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
                {label(role)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {needsDefaults && (roles.isPending || defaults.isPending) && (
        <div className="mt-2">
          <Loading />
        </div>
      )}
      {!readOnly && failed.length > 0 && (
        <div className="mt-2">
          <LoadError
            message={t('settings.users.sheet.role.loadError')}
            onRetry={() => failed.forEach((q) => void q.refetch())}
            retrying={failed.some((q) => q.isFetching)}
          />
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
                : t('settings.users.sheet.role.demote.body', { name: user.display_name, role: draft ? label(draft) : '' })}
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
  // The clinic's defaults (org_role_permissions), what has_permission evaluates (decision #40).
  const defaults = useRoleDefaults()
  const isAdmin = user.role === 'admin'
  const overrides = useUserOverrides(isAdmin ? undefined : user.user_id)
  const reset = useResetPermissions()

  let body
  if (isAdmin) {
    body = <p className="text-sm text-muted-foreground">{t('settings.users.sheet.permissions.admin')}</p>
  } else if (catalog.isPending || defaults.isPending || overrides.isPending) {
    body = <Loading />
  } else if (!catalog.data || !defaults.data || !overrides.data) {
    const queries = [catalog, defaults, overrides]
    body = (
      <LoadError
        message={t('settings.users.sheet.permissions.loadError')}
        retrying={queries.some((q) => q.isFetching)}
        onRetry={() => {
          for (const q of queries) if (q.isError) void q.refetch()
        }}
      />
    )
  } else {
    const roleSet = roleGrants(user.role, defaults.data)
    const groups = groupPermissionsByModule(catalog.data.permissions, catalog.data.modules, access?.modules ?? [])
    // The permissions of disabled modules have no row, but their exceptions stay (and the reset clears them).
    const shown = new Set(groups.flatMap((group) => group.permissions.map((p) => p.key)))
    const moduleNames = new Map(catalog.data.modules.map((m) => [m.key, permissionGroupName(m)]))
    const hiddenModules = new Map(
      catalog.data.permissions.filter((p) => !shown.has(p.key)).map((p) => [p.key, moduleNames.get(p.module_key) ?? p.module_key]),
    )
    body = (
      <div className="space-y-5">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('settings.users.sheet.permissions.description')}
            {!callerIsAdmin && !locked && <> {t('settings.users.sheet.permissions.managerLimit')}</>}
          </p>
          {!locked && (
            <ResetPermissions
              user={user}
              overrides={overrides.data}
              hiddenModules={hiddenModules}
              callerIsAdmin={callerIsAdmin}
              pending={reset.isPending}
              onConfirm={() => reset.mutate({ userId: user.user_id })}
            />
          )}
        </div>
        {groups.map((group) => (
          <div key={group.key} className="space-y-3">
            <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{permissionGroupName(group)}</h4>
            {group.permissions.map((permission) => {
              const byRole = roleSet.has(permission.key)
              const { on, override } = effectivePermission(permission.key, byRole, overrides.data)
              return (
                <PermissionRow
                  key={permission.key}
                  userId={user.user_id}
                  permission={permission}
                  byRole={byRole}
                  on={on}
                  isException={override !== null}
                  canToggle={canTogglePermission({ callerIsAdmin, callerCan: can, permissionKey: permission.key, on })}
                  locked={locked}
                  resetting={reset.isPending}
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

interface ResetPermissionsProps {
  user: OrgUser
  overrides: PermissionOverride[]
  /** The permissions without a row (their module is disabled), with the module's name. */
  hiddenModules: Map<string, string>
  callerIsAdmin: boolean
  pending: boolean
  onConfirm: () => void
}

const listFormat = new Intl.ListFormat('fr-CA', { type: 'conjunction' })

/** The confirmation: which exceptions go (those of disabled modules named), then what the person keeps. */
function resetBody(user: OrgUser, count: number, hidden: number): string {
  const values = { name: user.display_name, count: String(count), hidden: String(hidden) }
  const removed =
    count === 1
      ? t(hidden === 1 ? 'settings.users.sheet.permissions.reset.body.oneHidden' : 'settings.users.sheet.permissions.reset.body.one', values)
      : hidden === 0
        ? t('settings.users.sheet.permissions.reset.body.other', values)
        : hidden === count
          ? t('settings.users.sheet.permissions.reset.body.otherAllHidden', values)
          : hidden === 1
            ? t('settings.users.sheet.permissions.reset.body.otherHiddenOne', values)
            : t('settings.users.sheet.permissions.reset.body.otherHidden', values)
  const after = user.role
    ? t('settings.users.sheet.permissions.reset.body.role', { role: roleLabel(user.role, user.role_name) })
    : t('settings.users.sheet.permissions.reset.body.noRole')
  return `${removed} ${after}`
}

/**
 * « Rétablir les permissions du rôle (n) »: removes all of the person's exceptions after a
 * confirmation (one atomic RPC). The count is all of them, those of disabled modules included
 * (no row shows them; the confirmation says how many). Inactive without exceptions, while it or a
 * switch saves, and for a non-admin manager when an exception revokes a permission they lack (the
 * server would refuse; the hint names the module when that exception has no row). Inactive means
 * `aria-disabled`: after the reset the button keeps focus.
 */
function ResetPermissions({ user, overrides, hiddenModules, callerIsAdmin, pending, onConfirm }: ResetPermissionsProps) {
  const { can } = useAccess()
  const switchSaving = useIsSavingPermission(user.user_id)
  const [confirming, setConfirming] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const count = overrides.length
  const hidden = overrides.filter((o) => hiddenModules.has(o.permission_key)).length
  const blocked = count > 0 && !canResetOverrides({ callerIsAdmin, callerCan: can, overrides })
  const inactive = count === 0 || blocked || pending || switchSaving
  // The modules of the blocking revokes that have no row, by name.
  const blockingHidden = blocked
    ? [
        ...new Set(
          overrides.filter((o) => !o.granted && !can(o.permission_key)).flatMap((o) => hiddenModules.get(o.permission_key) ?? []),
        ),
      ].sort((a, b) => a.localeCompare(b, 'fr-CA'))
    : []
  const hint =
    blockingHidden.length === 0
      ? t('settings.users.sheet.permissions.reset.blocked')
      : blockingHidden.length === 1
        ? t('settings.users.sheet.permissions.reset.blockedHidden', { module: blockingHidden[0] ?? '' })
        : t('settings.users.sheet.permissions.reset.blockedHiddenOther', { modules: listFormat.format(blockingHidden) })

  return (
    <div className="space-y-1">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        aria-disabled={inactive || undefined}
        aria-describedby={blocked ? hintId : undefined}
        className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card', pending && 'cursor-progress')}
        onClick={ignoreWhenInactive(inactive, () => setConfirming(true))}
      >
        {count === 0
          ? t('settings.users.sheet.permissions.reset.label')
          : t('settings.users.sheet.permissions.reset.labelCount', { count: String(count) })}
      </Button>
      {blocked && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          // Opened without a trigger: focus goes back to the button, whatever the answer.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            buttonRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.users.sheet.permissions.reset.title')}</AlertDialogTitle>
            <AlertDialogDescription>{resetBody(user, count, hidden)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>{t('settings.users.sheet.permissions.reset.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface PermissionRowProps {
  userId: string
  permission: CatalogPermission
  /** Whether the user's role gives it by default. */
  byRole: boolean
  /** The effective permission: the exception's value, else the role default. */
  on: boolean
  /** An override exists (shown as « Exception · rôle : Oui/Non »). */
  isException: boolean
  /** The caller may flip it (a non-admin manager turns on only what they hold). */
  canToggle: boolean
  locked: boolean
  /** « Rétablir » is saving: toggles are ignored meanwhile. */
  resetting: boolean
}

/**
 * One permission: its description and a switch showing the effective permission, with
 * « Exception · rôle : Oui/Non » when an override sets it (the role default stays visible, which
 * matters most when the exception equals it). Turning it to the role value removes the exception;
 * turning it to the other value creates one. A click, Space or Enter toggles (the switch is a
 * Radix button); the arrow keys do nothing (decision #36). The change is saved at once
 * (optimistic, with a toast), and further toggles are ignored while it or the reset saves. When
 * the caller may not turn it on, the switch is read-only; the reason is in its description only
 * (visually hidden): the section's note says it once for all rows.
 */
function PermissionRow({ userId, permission, byRole, on, isException, canToggle, locked, resetting }: PermissionRowProps) {
  const switchId = useId()
  const exceptionId = useId()
  const hintId = useId()
  const save = useSetPermissionState(userId)
  const busy = save.isPending || resetting
  const lacked = !locked && !canToggle
  const describedBy = [isException && exceptionId, lacked && hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Label htmlFor={switchId} className="font-normal">
            {permission.description}
          </Label>
          {isException && (
            <Badge id={exceptionId} variant="info">
              {t('settings.users.sheet.permissions.exception', {
                value: t(byRole ? 'settings.users.sheet.permissions.yes' : 'settings.users.sheet.permissions.no'),
              })}
            </Badge>
          )}
        </div>
        <Switch
          id={switchId}
          checked={on}
          readOnly={locked || lacked}
          aria-disabled={busy || undefined}
          aria-describedby={describedBy}
          className={cn('mt-0.5', busy && 'cursor-progress')}
          onCheckedChange={(next) => {
            if (busy) return
            save.mutate({ key: permission.key, state: stateForSwitch(byRole, next), on: next, label: permission.description })
          }}
        />
      </div>
      {lacked && (
        <span id={hintId} className="sr-only">
          {t('settings.users.sheet.permissions.lackedHint')}
        </span>
      )}
    </div>
  )
}
