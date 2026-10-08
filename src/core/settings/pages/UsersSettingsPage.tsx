import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import { useSettingsSection } from '@/core/settings/section-context'
import type { OrgUser } from '@/core/users/api'
import { RoleMatrix } from '@/core/users/components/RoleMatrix'
import { LoadError, Loading } from '@/core/users/components/LoadState'
import { UserSheet } from '@/core/users/components/UserSheet'
import { useOrgUsers } from '@/core/users/hooks'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { initialsOf } from '@/shared/lib/format'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Badge } from '@/shared/ui/badge'
import { focusRing } from '@/shared/ui/field-classes'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

type Tab = 'users' | 'roles'
const TABS: Tab[] = ['users', 'roles']
const isTab = (value: string): value is Tab => (TABS as string[]).includes(value)

/**
 * Paramètres → Utilisateurs et accès: the clinic's users (tab « Utilisateurs », with users.view)
 * and what each role gives by default (tab « Rôles », editable with roles.manage). The section opens
 * with either permission, on the first tab the user can see. With users.manage, a row opens the
 * user's sheet (role, status, permission overrides); with users.view only, the table is read-only.
 * People are added by hand until invitations exist (decision #22).
 */
export function UsersSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { can } = useAccess()
  // With roles.manage, only the users are read-only: the notice goes in their tab.
  const usersOnlyReadOnly = readOnly && can('roles.manage')
  // The users need users.view (list_org_users refuses otherwise); the roles show to whoever is here.
  const tabs = TABS.filter((value) => value !== 'users' || can('users.view'))
  const [selected, setTab] = useState<Tab | null>(null)
  // The chosen tab while it is visible, else the first one (also after a permission change).
  const tab = selected !== null && tabs.includes(selected) ? selected : (tabs[0] ?? 'roles')

  return (
    <div className="max-w-content space-y-5">
      <PageHeader title={t('settings.sections.users')} description={t('settings.users.description')} />
      {readOnly && !usersOnlyReadOnly && <ReadOnlyNotice />}
      {/* Page-level views: real tabs, reachable by keyboard (decision #35). */}
      <Tabs value={tab} onValueChange={(value) => isTab(value) && setTab(value)}>
        <TabsList>
          {tabs.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`settings.users.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.includes('users') && (
          <TabsContent value="users" className="mt-5 space-y-5">
            {usersOnlyReadOnly && <ReadOnlyNotice />}
            <UsersTab canManage={!readOnly} />
          </TabsContent>
        )}
        <TabsContent value="roles" className="mt-5">
          <RoleMatrix />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function UsersTab({ canManage }: { canManage: boolean }) {
  const { data: users, isPending, isError, isFetching, refetch } = useOrgUsers()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // From the list, so the sheet shows the refreshed user after each change.
  const selected = users?.find((u) => u.user_id === selectedId) ?? null
  // The name buttons, so focus returns to the opened row's button when the sheet closes (also
  // after a click elsewhere on the row).
  const nameButtons = useRef(new Map<string, HTMLButtonElement>())
  const lastOpened = useRef<string | null>(null)
  const open = (userId: string) => {
    lastOpened.current = userId
    setSelectedId(userId)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('settings.users.addNote')}</p>
      {isPending ? (
        <Loading />
      ) : isError && !users ? (
        <LoadError message={t('settings.users.loadError')} onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
        <UsersTable
          users={users}
          canManage={canManage}
          selectedId={selected?.user_id ?? null}
          onOpen={open}
          registerButton={(userId, button) => {
            if (button) nameButtons.current.set(userId, button)
            else nameButtons.current.delete(userId)
          }}
        />
      )}
      {canManage && (
        <UserSheet
          user={selected}
          onClose={() => setSelectedId(null)}
          returnFocus={() => {
            if (lastOpened.current) nameButtons.current.get(lastOpened.current)?.focus()
          }}
        />
      )}
    </div>
  )
}

interface UsersTableProps {
  users: OrgUser[]
  canManage: boolean
  selectedId: string | null
  onOpen: (userId: string) => void
  registerButton: (userId: string, button: HTMLButtonElement | null) => void
}

/**
 * Nom (avatar, name; the email under it on phones), Courriel, Rôle, Statut, Dernière connexion.
 * On phones the email, status and last sign-in columns are hidden: the email shows under the name,
 * the status under the role, the last sign-in in the sheet. The name is a button for keyboard
 * users; a click anywhere on the row opens the sheet too.
 */
function UsersTable({ users, canManage, selectedId, onOpen, registerButton }: UsersTableProps) {
  const lastSignIn = (u: OrgUser) => (u.last_sign_in_at ? formatClinicDateTime(u.last_sign_in_at) : t('settings.users.never'))
  return (
    <div className="rounded-lg border border-border bg-card">
      <Table scrollLabel={t('settings.users.tableLabel')} className="whitespace-nowrap">
        <TableCaption className="sr-only">{t('settings.users.tableLabel')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('settings.users.columns.name')}</TableHead>
            <TableHead scope="col" className="max-sm:hidden">
              {t('settings.users.columns.email')}
            </TableHead>
            <TableHead scope="col">{t('settings.users.columns.role')}</TableHead>
            <TableHead scope="col" className="max-sm:hidden">
              {t('settings.users.columns.status')}
            </TableHead>
            <TableHead scope="col" className="max-sm:hidden">
              {t('settings.users.columns.lastSignIn')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const active = u.status === 'active'
            const status = (
              <Badge variant={active ? 'success' : 'error'}>{t(active ? 'settings.users.status.active' : 'settings.users.status.disabled')}</Badge>
            )
            return (
              <TableRow
                key={u.user_id}
                data-state={u.user_id === selectedId ? 'selected' : undefined}
                onClick={
                  canManage
                    ? () => {
                        // Selecting text (to copy an email) is not a click on the row.
                        if (window.getSelection()?.toString()) return
                        onOpen(u.user_id)
                      }
                    : undefined
                }
                className={cn(canManage && 'cursor-pointer')}
              >
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar size="sm" aria-hidden>
                      <AvatarFallback className="text-muted-foreground">{initialsOf(u.display_name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      {canManage ? (
                        <button
                          ref={(button) => registerButton(u.user_id, button)}
                          type="button"
                          className={`block max-w-full truncate rounded-sm text-left font-medium hover:underline ${focusRing}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpen(u.user_id)
                          }}
                        >
                          {u.display_name}
                        </button>
                      ) : (
                        <span className="block truncate font-medium">{u.display_name}</span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground sm:hidden">{u.email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground max-sm:hidden">{u.email}</TableCell>
                <TableCell className="max-sm:whitespace-normal">
                  {u.role ? roleLabel(u.role, u.role_name) : <span className="text-muted-foreground">{t('settings.users.noRole')}</span>}
                  <span className="block sm:hidden">{status}</span>
                </TableCell>
                <TableCell className="max-sm:hidden">{status}</TableCell>
                <TableCell className="text-muted-foreground max-sm:hidden">{lastSignIn(u)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {users.length === 1 ? t('settings.users.countOne') : t('settings.users.countOther', { count: String(users.length) })}
      </p>
    </div>
  )
}
