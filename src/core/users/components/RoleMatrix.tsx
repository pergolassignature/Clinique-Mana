import { Check } from 'lucide-react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import { usePermissionCatalog } from '../hooks'
import {
  groupPermissionsByModule,
  orderRoles,
  roleGrants,
} from '../permissions'
import { permissionGroupName } from './group-name'
import { LoadError, Loading } from './LoadState'

/**
 * « Rôles » tab: what each role gives by default, read-only. Permissions as rows grouped by module
 * (core first, then the enabled modules), roles as columns, ✓ or —. Exceptions are made per person.
 */
export function RoleMatrix() {
  const { modules: enabledModules } = useReadyAccess()
  const {
    data: catalog,
    isPending,
    isError,
    isFetching,
    refetch,
  } = usePermissionCatalog()

  if (isPending) return <Loading />
  if (isError && !catalog)
    return (
      <LoadError
        message={t('settings.users.matrix.loadError')}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    )

  const roles = orderRoles(catalog.roles)
  const grants = new Map(
    roles.map((role) => [
      role.key,
      roleGrants(role.key, catalog.rolePermissions),
    ])
  )
  const groups = groupPermissionsByModule(
    catalog.permissions,
    catalog.modules,
    enabledModules
  )

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('settings.users.matrix.note')}
      </p>
      <div className="rounded-lg border border-border bg-card">
        <Table scrollLabel={t('settings.users.matrix.tableLabel')}>
          <TableCaption className="sr-only">
            {t('settings.users.matrix.tableLabel')}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('settings.users.matrix.permission')}
              </TableHead>
              {roles.map((role) => (
                <TableHead
                  key={role.key}
                  scope="col"
                  className="whitespace-nowrap text-center"
                >
                  {roleLabel(role.key, role.name)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          {/* One tbody per module, headed by a rowgroup header. */}
          {groups.map((group) => (
            <TableBody key={group.key}>
              <TableRow className="hover:bg-transparent">
                <th
                  scope="rowgroup"
                  colSpan={roles.length + 1}
                  className="border-t border-border bg-muted px-3 py-1.5 text-left text-2xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {permissionGroupName(group)}
                </th>
              </TableRow>
              {group.permissions.map((permission) => (
                <TableRow key={permission.key}>
                  <th
                    scope="row"
                    className="min-w-[200px] px-3 py-2 text-left align-middle font-normal"
                  >
                    {permission.description}
                  </th>
                  {roles.map((role) => {
                    const has =
                      grants.get(role.key)?.has(permission.key) ?? false
                    return (
                      <TableCell key={role.key} className="text-center">
                        {has ? (
                          <Check
                            aria-hidden
                            className="mx-auto inline h-3.5 w-3.5 text-foreground"
                          />
                        ) : (
                          <span aria-hidden className="text-subtle">
                            —
                          </span>
                        )}
                        <span className="sr-only">
                          {t(
                            has
                              ? 'settings.users.matrix.yes'
                              : 'settings.users.matrix.no'
                          )}
                        </span>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
      </div>
    </div>
  )
}
