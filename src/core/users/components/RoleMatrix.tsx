import { useCallback, useId, useRef, useState } from 'react'
import { Check, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Switch } from '@/shared/ui/switch'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { CatalogPermission, OrgRole } from '../api'
import { useOrgRoles, usePendingRolePermissions, usePermissionCatalog, useRoleDefaults, useSetRolePermission } from '../hooks'
import { groupPermissionsByModule, isCustomRole, orderRoles, roleCellLock, roleGrants, type RoleCellLock, type RolePermission } from '../permissions'
import { DeleteRoleDialog } from './DeleteRoleDialog'
import { permissionGroupName } from './group-name'
import { LoadError, Loading } from './LoadState'
import { RoleNameDialog } from './RoleNameDialog'

/** The sticky first column: it stays put while the role columns scroll under it (phones). */
const STICKY = 'sticky left-0 z-10 bg-card'

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
 *   role's column (the database's hold rule); turning one off is always allowed. A read-only
 *   cell names the reason through its description (the visible notes);
 * - « Nouveau rôle », and on each custom role's column a menu: « Renommer », « Supprimer ».
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
  const [dialog, setDialogState] = useState<RoleDialog | null>(null)
  const newRoleRef = useRef<HTMLButtonElement>(null)
  const menuTriggers = useRef(new Map<string, HTMLButtonElement>())
  // The role whose menu opened the dialog: focus goes back there (the dialog state is gone by then).
  const dialogRole = useRef<string | null>(null)
  const setDialog = (next: RoleDialog | null) => {
    if (next) dialogRole.current = next.kind === 'create' ? null : next.role.key
    setDialogState(next)
  }
  const noteIds = { admin: useId(), provider: useId(), lacked: useId(), ownRole: useId() }

  const roles = orderRoles(unordered)
  const grants = new Map(roles.map((role) => [role.key, roleGrants(role.key, rolePermissions)]))
  const groups = groupPermissionsByModule(permissions, modules, enabledModules)

  /** Back to the role's menu button when the role is still there, else to « Nouveau rôle ». */
  const returnFocus = (event: Event) => {
    event.preventDefault()
    const trigger = dialogRole.current === null ? undefined : menuTriggers.current.get(dialogRole.current)
    ;(trigger?.isConnected ? trigger : newRoleRef.current)?.focus()
  }

  const lockDescription = (role: string, lock: RoleCellLock | null) =>
    lock === null ? undefined : lock === 'locked' ? (role === 'admin' ? noteIds.admin : noteIds.provider) : noteIds[lock]

  return (
    <div className="space-y-3">
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
                        registerTrigger={(button) => {
                          if (button) menuTriggers.current.set(role.key, button)
                          else menuTriggers.current.delete(role.key)
                        }}
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
              <TableRow className="hover:bg-transparent">
                <th scope="rowgroup" colSpan={roles.length + 1} className="border-t border-border bg-muted px-3 py-1.5 text-left text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {/* Sticky too, so the module name stays in view while the columns scroll. */}
                  <span className="sticky left-3">{permissionGroupName(group)}</span>
                </th>
              </TableRow>
              {group.permissions.map((permission) => (
                // No hover fill: the sticky cell would not follow it.
                <TableRow key={permission.key} className="hover:bg-transparent">
                  <th scope="row" className={cn(STICKY, 'min-w-[160px] px-3 py-2 text-left align-middle font-normal sm:min-w-[200px]')}>
                    {permission.description}
                  </th>
                  {roles.map((role) => {
                    const on = grants.get(role.key)?.has(permission.key) ?? false
                    if (!canManage) {
                      return (
                        <TableCell key={role.key} className="text-center">
                          {on ? <Check aria-hidden className="mx-auto inline h-3.5 w-3.5 text-foreground" /> : <span aria-hidden className="text-subtle">—</span>}
                          <span className="sr-only">{t(on ? 'settings.users.matrix.yes' : 'settings.users.matrix.no')}</span>
                        </TableCell>
                      )
                    }
                    const name = roleLabel(role.key, role.name)
                    const lock = roleCellLock({ callerIsAdmin, callerCan: can, callerRole, role: role.key, permissionKey: permission.key, on })
                    const busy = pending.has(`${role.key}:${permission.key}`)
                    return (
                      <TableCell key={role.key} className="text-center">
                        <Switch
                          checked={on}
                          readOnly={lock !== null}
                          aria-label={t('settings.users.matrix.cellLabel', { role: name, permission: permission.description })}
                          aria-describedby={lockDescription(role.key, lock)}
                          aria-disabled={busy || undefined}
                          className={cn('align-middle', busy && 'cursor-progress')}
                          onCheckedChange={(next) => {
                            if (busy) return
                            setPermission.mutate({ role: role.key, permissionKey: permission.key, granted: next, roleName: name, permissionLabel: permission.description })
                          }}
                        />
                      </TableCell>
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
          />
          <DeleteRoleDialog role={dialog?.kind === 'delete' ? dialog.role : null} onClose={() => setDialog(null)} onCloseAutoFocus={returnFocus} />
        </>
      )}
    </div>
  )
}

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
        <Button ref={registerTrigger} type="button" variant="ghost" size="icon-sm" className="shrink-0 normal-case tracking-normal" aria-label={t('settings.users.matrix.roleActions', { role: role.name })}>
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
