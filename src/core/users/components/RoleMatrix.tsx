import { useEffect, useRef, useState, type RefObject } from 'react'
import { Check } from 'lucide-react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import { cn } from '@/shared/lib/utils'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { usePermissionCatalog } from '../hooks'
import { groupPermissionsByModule, orderRoles, roleGrants } from '../permissions'
import { permissionGroupName } from './group-name'
import { LoadError, Loading } from './LoadState'

/** The sticky first column: it stays put while the role columns scroll under it (phones). */
const STICKY = 'sticky left-0 z-10 bg-card'

/**
 * Whether the table's scroll region (the Table wrapper inside `container`) has columns left to
 * scroll to on the right; follows scrolling and resizing.
 */
function useMoreOnTheRight(container: RefObject<HTMLDivElement | null>) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const region = container.current?.querySelector<HTMLElement>('[role=region]')
    if (!region) return
    const update = () => setMore(region.scrollLeft + region.clientWidth < region.scrollWidth - 1)
    update()
    region.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(region)
    return () => {
      region.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  })
  return more
}

/**
 * « Rôles » tab: what each role gives by default, read-only. Permissions as rows grouped by module
 * (core first, then the enabled modules), roles as columns, ✓ or —. Exceptions are made per person.
 * On narrow screens the permission column stays put and a fade on the right says more roles follow.
 */
export function RoleMatrix() {
  const { modules: enabledModules } = useReadyAccess()
  const { data: catalog, isPending, isError, isFetching, refetch } = usePermissionCatalog()
  const container = useRef<HTMLDivElement>(null)
  const more = useMoreOnTheRight(container)

  if (isPending) return <Loading />
  if (isError && !catalog) return <LoadError message={t('settings.users.matrix.loadError')} onRetry={() => void refetch()} retrying={isFetching} />

  const roles = orderRoles(catalog.roles)
  const grants = new Map(roles.map((role) => [role.key, roleGrants(role.key, catalog.rolePermissions)]))
  const groups = groupPermissionsByModule(catalog.permissions, catalog.modules, enabledModules)

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('settings.users.matrix.note')}</p>
      <div ref={container} className="relative rounded-lg border border-border bg-card">
        <Table scrollLabel={t('settings.users.matrix.tableLabel')}>
          <TableCaption className="sr-only">{t('settings.users.matrix.tableLabel')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className={cn(STICKY, 'min-w-[160px] sm:min-w-[200px]')}>
                {t('settings.users.matrix.permission')}
              </TableHead>
              {roles.map((role) => (
                <TableHead key={role.key} scope="col" className="min-w-[76px] text-center">
                  {roleLabel(role.key, role.name)}
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
                // No hover fill: the table is read-only, and the sticky cell would not follow it.
                <TableRow key={permission.key} className="hover:bg-transparent">
                  <th scope="row" className={cn(STICKY, 'min-w-[160px] px-3 py-2 text-left align-middle font-normal sm:min-w-[200px]')}>
                    {permission.description}
                  </th>
                  {roles.map((role) => {
                    const has = grants.get(role.key)?.has(permission.key) ?? false
                    return (
                      <TableCell key={role.key} className="text-center">
                        {has ? <Check aria-hidden className="mx-auto inline h-3.5 w-3.5 text-foreground" /> : <span aria-hidden className="text-subtle">—</span>}
                        <span className="sr-only">{t(has ? 'settings.users.matrix.yes' : 'settings.users.matrix.no')}</span>
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
    </div>
  )
}
