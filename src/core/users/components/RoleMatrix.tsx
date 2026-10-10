import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type RefObject } from 'react'
import { Check, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import type { CatalogPermission, OrgRole } from '@/core/access/api'
import { usePermissionCatalog } from '@/core/access/catalog'
import { useOrgRoles } from '@/core/access/org-roles'
import { roleLabel } from '@/core/access/roles'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { cn } from '@/shared/lib/utils'
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
import { Button, buttonVariants } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Switch } from '@/shared/ui/switch'
import { Table, TableBody, TableCaption, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { usePendingRolePermissions, useRoleDefaults, useSetRolePermission, type RolePermissionVariables } from '../hooks'
import {
  confirmsSelfRemoval,
  groupPermissionsByModule,
  isCustomRole,
  orderRoles,
  roleCellLock,
  roleGrants,
  type RoleCellLock,
  type RolePermission,
} from '../permissions'
import { DeleteRoleDialog } from './DeleteRoleDialog'
import { permissionGroupName } from './group-name'
import { RoleNameDialog } from './RoleNameDialog'

/** The sticky first column: it stays put while the role columns scroll under it (phones). */
const STICKY = 'sticky left-0 z-10 bg-card'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The tab whose panel holds the element (Radix links them by aria-labelledby), if any. */
function tabOf(element: HTMLElement): HTMLElement | null {
  const tabId = element.closest('[role=tabpanel]')?.getAttribute('aria-labelledby')
  return tabId ? document.getElementById(tabId) : null
}

/**
 * Keeps focus on the page when the matrix turns read-only under it (the caller has just removed
 * roles.manage from her own role, or lost it elsewhere): the switch she was on goes, and focus
 * would drop to <body>. It then moves to the matrix's first focusable element, else its tab
 * (« Rôles »). Returns the root's focus handler, which remembers the last element focused in it.
 */
function useFocusFallbackOnReadOnly(rootRef: RefObject<HTMLDivElement | null>, canManage: boolean) {
  const lastFocused = useRef<HTMLElement | null>(null)
  const wasManaging = useRef(canManage)
  useEffect(() => {
    const lost = wasManaging.current && !canManage
    wasManaging.current = canManage
    const root = rootRef.current
    const last = lastFocused.current
    if (!lost || !root || !last || last.isConnected) return
    if (document.activeElement && document.activeElement !== document.body) return
    ;(root.querySelector<HTMLElement>(FOCUSABLE) ?? tabOf(root))?.focus()
  }, [canManage, rootRef])
  return (event: FocusEvent) => {
    // Through React's tree: the dialogs (portals) count as inside.
    if (event.target instanceof HTMLElement) lastFocused.current = event.target
  }
}

/**
 * Whether the table's scroll region (the Table wrapper inside the container) has columns left to
 * scroll to on the right. Returns a callback ref for the container: it subscribes when the
 * container mounts (scroll, and resizes of the region and the table) and unsubscribes when it
 * unmounts (React 19 ref cleanup).
 */
function useMoreOnTheRight() {
  const [more, setMore] = useState(false)
  const track = useCallback((container: HTMLDivElement | null) => {
    const region = container?.querySelector<HTMLElement>('[role=region]')
    if (!region) return
    const update = () => setMore(region.scrollLeft + region.clientWidth < region.scrollWidth - 1)
    update()
    region.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(region)
    if (region.firstElementChild) observer?.observe(region.firstElementChild)
    return () => {
      region.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [])
  return [more, track] as const
}

/**
 * « Rôles » tab: what each role gives by default in the clinic. Permissions as rows grouped by
 * module (core first, then the enabled modules), roles as columns. Exceptions are made per person.
 * The permission catalogue, the roles and their defaults load in parallel.
 *
 * Without roles.manage the matrix is read-only (✓ or —). With it (decision #40), each cell is a
 * switch saved at once, and custom roles can be created, renamed and deleted; see `MatrixTable`.
 */
export function RoleMatrix() {
  const catalog = usePermissionCatalog()
  const roles = useOrgRoles()
  const defaults = useRoleDefaults()
  const queries = [catalog, roles, defaults]

  if (queries.some((q) => q.isPending)) return <Loading />
  if (!catalog.data || !roles.data || !defaults.data) {
    return (
      <LoadError
        message={t('settings.users.matrix.loadError')}
        retrying={queries.some((q) => q.isFetching)}
        onRetry={() => {
          for (const q of queries) if (q.isError) void q.refetch()
        }}
      />
    )
  }
  return <MatrixTable permissions={catalog.data.permissions} modules={catalog.data.modules} roles={roles.data} rolePermissions={defaults.data} />
}

type RoleDialog = { kind: 'create' } | { kind: 'rename' | 'delete'; role: OrgRole }

interface MatrixTableProps {
  permissions: CatalogPermission[]
  modules: { key: string; name: string }[]
  roles: OrgRole[]
  rolePermissions: RolePermission[]
}

/**
 * The matrix. With roles.manage:
 * - each cell is a switch named « Rôle : Permission ». A click, Space or Enter toggles it; the
 *   arrow keys do nothing (decision #36). It saves at once (optimistic, with a toast; back on a
 *   refusal), and ignores further toggles while it saves;
 * - Administrateur and Professionnel are read-only, with their note (the database refuses them);
 * - a non-admin manager turns a cell on only for a permission she holds, and never in her own
 *   role's column (the database's hold rule); turning one off is always allowed, but removing
 *   roles.manage or users.manage from her own role asks first. A read-only cell names the reason
 *   through its description (the visible notes);
 * - « Nouveau rôle », and on each custom role's column a menu: « Renommer », « Supprimer ». A
 *   dialog whose role has gone (deleted by another manager, seen on a refetch) closes.
 * On narrow screens the permission column stays put and a fade on the right says more roles follow.
 */
function MatrixTable({ permissions, modules, roles: unordered, rolePermissions }: MatrixTableProps) {
  const { modules: enabledModules, role: callerRole } = useReadyAccess()
  const { can } = useAccess()
  const canManage = can('roles.manage')
  const callerIsAdmin = callerRole === 'admin'
  const [more, trackScroll] = useMoreOnTheRight()
  const setPermission = useSetRolePermission()
  const pending = usePendingRolePermissions()
  // The cells saving, set synchronously: a second toggle before the re-render is ignored too.
  const saving = useRef(new Set<string>())
  // A removal waiting for « Retirer » (confirmsSelfRemoval); focus goes back to the last switch toggled.
  const [removal, setRemoval] = useState<RolePermissionVariables | null>(null)
  const toggledSwitch = useRef<HTMLElement | null>(null)
  const [dialogState, setDialogState] = useState<RoleDialog | null>(null)
  // A rename or deletion whose role is no longer listed closes, whoever deleted it, and stays
  // closed (state adjusted while rendering, not in an effect: no frame shows it open).
  const dialogRoleGone = dialogState !== null && dialogState.kind !== 'create' && !unordered.some((r) => r.key === dialogState.role.key)
  if (dialogRoleGone) setDialogState(null)
  const dialog = dialogRoleGone ? null : dialogState
  const rootRef = useRef<HTMLDivElement>(null)
  const trackFocus = useFocusFallbackOnReadOnly(rootRef, canManage)
  const newRoleRef = useRef<HTMLButtonElement>(null)
  const menuTriggers = useRef(new Map<string, HTMLButtonElement>())
  // The role whose menu opened the dialog, or the role just created: focus goes there once the
  // dialog has closed (its state is gone by then).
  const dialogRole = useRef<string | null>(null)
  // A created role whose column had not rendered yet when the dialog closed: its menu button takes
  // focus as it mounts.
  const awaitedRole = useRef<string | null>(null)
  // The role « Nouveau rôle » has just created.
  const createdRole = useRef<string | null>(null)
  const setDialog = (next: RoleDialog | null) => {
    if (next) dialogRole.current = next.kind === 'create' ? null : next.role.key
    setDialogState(next)
  }
  /** The new role's column, scrolled into view, and its menu button focused. */
  const revealRole = (trigger: HTMLButtonElement) => {
    trigger.closest('th')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    trigger.focus()
  }
  // One stable callback ref per role (an inline one would detach and reattach on every render).
  const triggerRefs = useRef(new Map<string, (button: HTMLButtonElement | null) => void>())
  const registerTrigger = (roleKey: string) => {
    let ref = triggerRefs.current.get(roleKey)
    if (!ref) {
      ref = (button) => {
        if (!button) {
          menuTriggers.current.delete(roleKey)
          return
        }
        menuTriggers.current.set(roleKey, button)
        if (awaitedRole.current === roleKey) {
          awaitedRole.current = null
          revealRole(button)
        }
      }
      triggerRefs.current.set(roleKey, ref)
    }
    return ref
  }
  const noteIds = { admin: useId(), provider: useId(), lacked: useId(), ownRole: useId() }

  // Recomputed only when their data changes, not on every save or focus change.
  const roles = useMemo(() => orderRoles(unordered), [unordered])
  const grants = useMemo(() => new Map(roles.map((role) => [role.key, roleGrants(role.key, rolePermissions)])), [roles, rolePermissions])
  const groups = useMemo(() => groupPermissionsByModule(permissions, modules, enabledModules), [permissions, modules, enabledModules])

  /**
   * Back to the role's menu button when the role is still there, else to « Nouveau rôle ». After a
   * creation, to the new role's menu button, its column scrolled into view; until that column
   * renders, « Nouveau rôle » holds focus.
   */
  const returnFocus = (event: Event) => {
    event.preventDefault()
    const role = dialogRole.current
    const trigger = role === null ? undefined : menuTriggers.current.get(role)
    if (role !== null && role === createdRole.current) {
      createdRole.current = null
      if (trigger?.isConnected) return revealRole(trigger)
      awaitedRole.current = role
    }
    ;(trigger?.isConnected ? trigger : newRoleRef.current)?.focus()
  }
  const onCreated = (role: string) => {
    dialogRole.current = role
    createdRole.current = role
  }

  const lockDescription = (role: string, lock: RoleCellLock | null) =>
    lock === null ? undefined : lock === 'locked' ? (role === 'admin' ? noteIds.admin : noteIds.provider) : noteIds[lock]

  const { mutateAsync: savePermission } = setPermission
  /** Saves one cell, unless it is already saving. Stable, so the memoized cells do not re-render. */
  const save = useCallback(
    (variables: RolePermissionVariables) => {
      const cell = `${variables.role}:${variables.permissionKey}`
      if (saving.current.has(cell)) return
      saving.current.add(cell)
      // mutateAsync settles per call (mutate's own callbacks would only run for the latest cell).
      // The hook shows the outcome: the rejection is handled there.
      savePermission(variables)
        .catch(() => undefined)
        .finally(() => saving.current.delete(cell))
    },
    [savePermission],
  )
  /** A cell toggled: removing roles.manage or users.manage from her own role asks first. */
  const toggleCell = useCallback(
    (variables: RolePermissionVariables) => {
      const { role, permissionKey, granted: next } = variables
      if (confirmsSelfRemoval({ callerRole, role, permissionKey, next })) setRemoval(variables)
      else save(variables)
    },
    [callerRole, save],
  )
  const pressCell = useCallback((element: HTMLElement) => {
    toggledSwitch.current = element
  }, [])

  return (
    <div ref={rootRef} className="space-y-3" onFocus={trackFocus}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{t(canManage ? 'settings.users.matrix.noteManage' : 'settings.users.matrix.note')}</p>
          {canManage && (
            <ul className="space-y-0.5 text-xs">
              <li id={noteIds.admin}>{t('settings.users.matrix.adminNote')}</li>
              <li id={noteIds.provider}>{t('settings.users.matrix.providerNote')}</li>
              {!callerIsAdmin && <li id={noteIds.lacked}>{t('settings.users.matrix.managerLimit')}</li>}
              {!callerIsAdmin && <li id={noteIds.ownRole}>{t('settings.users.matrix.ownRoleNote')}</li>}
            </ul>
          )}
        </div>
        {canManage && (
          <Button ref={newRoleRef} type="button" variant="outline" onClick={() => setDialog({ kind: 'create' })}>
            <Plus aria-hidden />
            {t('settings.users.matrix.newRole')}
          </Button>
        )}
      </div>
      <div ref={trackScroll} className="relative rounded-lg border border-border bg-card">
        <Table scrollLabel={t('settings.users.matrix.tableLabel')}>
          <TableCaption className="sr-only">{t('settings.users.matrix.tableLabel')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className={cn(STICKY, 'min-w-[160px] sm:min-w-[200px]')}>
                {t('settings.users.matrix.permission')}
              </TableHead>
              {roles.map((role) => (
                <TableHead key={role.key} scope="col" className="min-w-[76px] max-w-[160px] text-center">
                  <div className="flex items-center justify-center gap-0.5">
                    <span className="break-words">{roleLabel(role.key, role.name)}</span>
                    {canManage && isCustomRole(role) && (
                      <RoleMenu
                        role={role}
                        registerTrigger={registerTrigger(role.key)}
                        onRename={() => setDialog({ kind: 'rename', role })}
                        onDelete={() => setDialog({ kind: 'delete', role })}
                      />
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          {/* One tbody per module, headed by a rowgroup header. */}
          {groups.map((group) => (
            <TableBody key={group.key}>
              <TableGroupRow colSpan={roles.length + 1}>
                {/* Sticky too, so the module name stays in view while the columns scroll. */}
                <span className="sticky left-3">{permissionGroupName(group)}</span>
              </TableGroupRow>
              {group.permissions.map((permission) => (
                // No hover fill: the sticky cell would not follow it.
                <TableRow key={permission.key} className="hover:bg-transparent">
                  <th scope="row" className={cn(STICKY, 'min-w-[160px] px-3 py-2 text-left align-middle font-normal sm:min-w-[200px]')}>
                    {permission.description}
                  </th>
                  {roles.map((role) => {
                    const on = grants.get(role.key)?.has(permission.key) ?? false
                    if (!canManage) return <RoleCell key={role.key} on={on} />
                    const lock = roleCellLock({ callerIsAdmin, callerCan: can, callerRole, role: role.key, permissionKey: permission.key, on })
                    return (
                      <RoleCell
                        key={role.key}
                        on={on}
                        role={role.key}
                        roleName={roleLabel(role.key, role.name)}
                        permissionKey={permission.key}
                        permissionLabel={permission.description}
                        readOnly={lock !== null}
                        describedBy={lockDescription(role.key, lock)}
                        busy={pending.has(`${role.key}:${permission.key}`)}
                        onToggle={toggleCell}
                        onPress={pressCell}
                      />
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
        {more && <div aria-hidden data-testid="matrix-more" className="pointer-events-none absolute inset-y-0 right-0 z-20 w-10 rounded-r-lg bg-gradient-to-l from-card to-transparent" />}
      </div>
      {canManage && (
        <>
          <RoleNameDialog
            open={dialog?.kind === 'create' || dialog?.kind === 'rename'}
            onOpenChange={(open) => !open && setDialog(null)}
            role={dialog?.kind === 'rename' ? dialog.role : undefined}
            roles={unordered}
            rolePermissions={rolePermissions}
            onCloseAutoFocus={returnFocus}
            onCreated={onCreated}
          />
          <DeleteRoleDialog role={dialog?.kind === 'delete' ? dialog.role : null} onClose={() => setDialog(null)} onCloseAutoFocus={returnFocus} />
          <AlertDialog open={removal !== null} onOpenChange={(open) => !open && setRemoval(null)}>
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                // Back to the switch (the dialog has no trigger).
                event.preventDefault()
                if (toggledSwitch.current?.isConnected) toggledSwitch.current.focus()
              }}
            >
              {removal && (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('settings.users.matrix.selfRemove.title')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('settings.users.matrix.selfRemove.body', { permission: removal.permissionLabel, role: removal.roleName })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    {/* Radix focuses Cancel first: keeping the permission is the safe default. */}
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={() => save(removal)}>
                      {t('settings.users.matrix.selfRemove.confirm')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              )}
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}

type RoleCellProps =
  | { on: boolean; role?: undefined }
  | {
      on: boolean
      role: string
      roleName: string
      permissionKey: string
      permissionLabel: string
      readOnly: boolean
      describedBy: string | undefined
      busy: boolean
      onToggle: (variables: RolePermissionVariables) => void
      onPress: (element: HTMLElement) => void
    }

/**
 * One cell of the matrix: ✓ or — without roles.manage, else the switch « Rôle : Permission »
 * (see `MatrixTable`). Memoized on primitive props and the table's stable callbacks: a save or a
 * focus change re-renders only the cells it changes.
 */
const RoleCell = memo(function RoleCell(props: RoleCellProps) {
  const { on } = props
  if (props.role === undefined) {
    return (
      <TableCell className="text-center">
        {on ? <Check aria-hidden className="mx-auto inline h-3.5 w-3.5 text-foreground" /> : <span aria-hidden className="text-subtle">—</span>}
        <span className="sr-only">{t(on ? 'settings.users.matrix.yes' : 'settings.users.matrix.no')}</span>
      </TableCell>
    )
  }
  const { role, roleName, permissionKey, permissionLabel, readOnly, describedBy, busy, onToggle, onPress } = props
  return (
    <TableCell className="text-center">
      <Switch
        checked={on}
        readOnly={readOnly}
        aria-label={t('settings.users.matrix.cellLabel', { role: roleName, permission: permissionLabel })}
        aria-describedby={describedBy}
        aria-disabled={busy || undefined}
        className={cn('align-middle', busy && 'cursor-progress')}
        // Click, Space and Enter all arrive as a click, before onCheckedChange (Safari does not
        // focus a clicked button, so document.activeElement would not do).
        onClick={(event) => onPress(event.currentTarget)}
        onCheckedChange={(next) => onToggle({ role, permissionKey, granted: next, roleName, permissionLabel })}
      />
    </TableCell>
  )
})

interface RoleMenuProps {
  role: OrgRole
  registerTrigger: (button: HTMLButtonElement | null) => void
  onRename: () => void
  onDelete: () => void
}

/**
 * A custom role's « … » menu. The chosen action runs once the menu has closed and given focus back
 * to its button, so the dialog it opens takes focus cleanly (and returns it there).
 */
function RoleMenu({ role, registerTrigger, onRename, onDelete }: RoleMenuProps) {
  const pendingAction = useRef<(() => void) | null>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* 28 px, with an invisible ::after making the hit area 32 × 32, like the switches. */}
        <Button
          ref={registerTrigger}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative shrink-0 normal-case tracking-normal after:absolute after:-inset-0.5 after:content-['']"
          aria-label={t('settings.users.matrix.roleActions', { role: role.name })}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const action = pendingAction.current
          pendingAction.current = null
          if (!action) return
          event.preventDefault()
          action()
        }}
      >
        <DropdownMenuItem onSelect={() => (pendingAction.current = onRename)}>
          <Pencil className="text-subtle" aria-hidden />
          {t('settings.users.matrix.rename')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => (pendingAction.current = onDelete)}>
          <Trash2 aria-hidden />
          {t('settings.users.matrix.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
