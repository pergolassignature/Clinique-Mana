import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import { useSettingsSection } from '@/core/settings/section-context'
import type { OrgUser, StaffInvitation } from '@/core/users/api'
import { InviteDialog } from '@/core/users/components/InviteDialog'
import { PendingInvitationRows } from '@/core/users/components/PendingInvitationRows'
import { RoleMatrix } from '@/core/users/components/RoleMatrix'
import { UserSheet } from '@/core/users/components/UserSheet'
import { useOrgUsers, useStaffInvitations } from '@/core/users/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
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
 * with either permission, on the first tab the user can see. Each tab follows its own right: with
 * users.manage, a row opens the user's sheet (role, status, permission overrides), else the table
 * is read-only; the matrix follows roles.manage. The section is read-only (the lock, one notice
 * for the page) only without either; otherwise a read-only users tab has its own notice.
 * People join by invitation (« Inviter », users.manage; Task 3.22): pending invitations are rows of
 * the same table.
 */
export function UsersSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { can } = useAccess()
  const canManageUsers = can('users.manage')
  // The users need users.view (list_org_users refuses otherwise); the roles show to whoever is here.
  const tabs = TABS.filter((value) => value !== 'users' || can('users.view'))
  const [selected, setTab] = useState<Tab | null>(null)
  // The chosen tab while it is visible, else the first one (also after a permission change).
  const tab = selected !== null && tabs.includes(selected) ? selected : (tabs[0] ?? 'roles')
  // A tab's content unmounts when another tab opens: unsaved edits there would go silently.
  const { onValueChange, triggerProps } = useGuardedTabs(tab, isTab, setTab)

  return (
    <div className="max-w-content space-y-5">
      <PageHeader title={t('settings.sections.users')} description={t('settings.users.description')} />
      {readOnly && <ReadOnlyNotice />}
      {/* Page-level views: real tabs, reachable by keyboard (decision #35). */}
      <Tabs value={tab} onValueChange={onValueChange}>
        <TabsList>
          {tabs.map((value) => (
            <TabsTrigger key={value} value={value} {...triggerProps(value)}>
              {t(`settings.users.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.includes('users') && (
          <TabsContent value="users" className="mt-5 space-y-5">
            {!readOnly && !canManageUsers && <ReadOnlyNotice />}
            <UsersTab canManage={canManageUsers} />
          </TabsContent>
        )}
        <TabsContent value="roles" className="mt-5">
          <RoleMatrix />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * The users and the pending invitations: two queries started together (no waterfall); the table
 * shows once both are in. When the users fail, the load error replaces the table, and
 * « Réessayer » asks again for what failed. When only the invitations fail, the users still show,
 * with the invitations' own load error above them.
 */
function UsersTab({ canManage }: { canManage: boolean }) {
  const usersQuery = useOrgUsers()
  const invitationsQuery = useStaffInvitations()
  const users = usersQuery.data
  const failed = [usersQuery, invitationsQuery].filter((q) => q.isError && !q.data)
  const invitationsFailed = invitationsQuery.isError && !invitationsQuery.data
  const invitations = invitationsQuery.data ?? (invitationsFailed ? [] : undefined)
  // « Inviter », where focus goes once an invitation's revocation is confirmed (its row goes).
  const inviteButton = useRef<HTMLButtonElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // From the list, so the sheet shows the refreshed user after each change.
  const selected = users?.find((u) => u.user_id === selectedId) ?? null
  // The name buttons, so focus returns to the opened row's button when the sheet closes (also
  // after a click elsewhere on the row).
  const nameButtons = useRef(new Map<string, HTMLButtonElement>())
  // One stable callback ref per user (an inline one would detach and reattach on every render).
  const buttonRefs = useRef(new Map<string, (button: HTMLButtonElement | null) => void>())
  const buttonRef = (userId: string) => {
    let ref = buttonRefs.current.get(userId)
    if (!ref) {
      ref = (button) => {
        if (button) nameButtons.current.set(userId, button)
        else nameButtons.current.delete(userId)
      }
      buttonRefs.current.set(userId, ref)
    }
    return ref
  }
  const lastOpened = useRef<string | null>(null)
  const open = (userId: string) => {
    lastOpened.current = userId
    setSelectedId(userId)
  }

  return (
    <div className="space-y-3">
      {/* The screen's one teal action (users.manage). */}
      {canManage && (
        <div className="flex justify-end">
          <InviteDialog triggerRef={inviteButton} />
        </div>
      )}
      {usersQuery.isError && !users ? (
        <LoadError
          message={t('settings.users.loadError')}
          onRetry={() => failed.forEach((q) => void q.refetch())}
          retrying={failed.some((q) => q.isFetching)}
        />
      ) : !users || !invitations ? (
        <Loading />
      ) : (
        <>
          {invitationsFailed && (
            <LoadError
              message={t('settings.users.invitations.loadError')}
              onRetry={() => void invitationsQuery.refetch()}
              retrying={invitationsQuery.isFetching}
            />
          )}
          <UsersTable
            users={users}
            invitations={invitations}
            canManage={canManage}
            selectedId={selected?.user_id ?? null}
            onOpen={open}
            buttonRef={buttonRef}
            onRevokeConfirmed={() => inviteButton.current?.focus()}
          />
        </>
      )}
      {canManage && (
        <UserSheet
          user={selected}
          onClose={() => setSelectedId(null)}
          returnFocus={() => {
            // A deleted account's row is gone: focus goes to « Inviter » instead.
            const row = lastOpened.current ? nameButtons.current.get(lastOpened.current) : undefined
            const target = row ?? inviteButton.current
            target?.focus()
          }}
        />
      )}
    </div>
  )
}

interface UsersTableProps {
  users: OrgUser[]
  invitations: StaffInvitation[]
  canManage: boolean
  selectedId: string | null
  onOpen: (userId: string) => void
  /** The name button's callback ref, the same function for a user on every render. */
  buttonRef: (userId: string) => (button: HTMLButtonElement | null) => void
  /** Moves focus once an invitation's revocation is confirmed (its row is going). */
  onRevokeConfirmed: () => void
}

/**
 * Nom (avatar, name; the email under it on phones), Courriel, Rôle, Statut, Activité: a user's last
 * sign-in (named for screen readers), an invitation's expiry and sender. On phones the email,
 * status and activity columns are hidden: the email shows under the name, the status under the
 * role, the last sign-in in the sheet. The name is a button for keyboard
 * users; a click anywhere on the row opens the sheet too. The active users come first, then the
 * pending invitations, then the disabled accounts; with users.manage and invitations, a last
 * column holds the invitations' actions.
 */
function UsersTable({ users, invitations, canManage, selectedId, onOpen, buttonRef, onRevokeConfirmed }: UsersTableProps) {
  const lastSignIn = (u: OrgUser) => (u.last_sign_in_at ? formatClinicDateTime(u.last_sign_in_at) : t('settings.users.never'))
  const actionsColumn = canManage && invitations.length > 0
  const userRow = (u: OrgUser) => {
    const active = u.status === 'active'
    const status = <Badge variant={active ? 'success' : 'error'}>{t(active ? 'settings.users.status.active' : 'settings.users.status.disabled')}</Badge>
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
                  ref={buttonRef(u.user_id)}
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
        <TableCell className="text-right text-muted-foreground max-sm:hidden">
          <span className="sr-only">{t('settings.users.lastSignIn')} </span>
          {lastSignIn(u)}
        </TableCell>
        {actionsColumn && <TableCell />}
      </TableRow>
    )
  }
  const count = [
    users.length === 1 ? t('settings.users.countOne') : t('settings.users.countOther', { count: String(users.length) }),
    ...(invitations.length === 0
      ? []
      : [invitations.length === 1 ? t('settings.users.invitations.countOne') : t('settings.users.invitations.countOther', { count: String(invitations.length) })]),
  ].join(' · ')
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
            {/* Dates: right-aligned, tabular (the cells' default). */}
            <TableHead scope="col" className="text-right max-sm:hidden">
              {t('settings.users.columns.activity')}
            </TableHead>
            {actionsColumn && (
              <TableHead scope="col">
                <span className="sr-only">{t('settings.users.invitations.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.filter((u) => u.status === 'active').map(userRow)}
          <PendingInvitationRows invitations={invitations} canManage={canManage} onRevokeConfirmed={onRevokeConfirmed} />
          {users.filter((u) => u.status !== 'active').map(userRow)}
        </TableBody>
      </Table>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{count}</p>
    </div>
  )
}
