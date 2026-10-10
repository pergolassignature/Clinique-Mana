import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import type { SettingsSection } from '@/core/modules/types'
import { isSectionReadOnly } from '@/core/settings/section-context'
import { coreSettingsSections } from '@/core/settings/sections'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { testCatalog, testRoleDefaults, testRoles, testUsers } from '@/test/users-fixtures'
import type { StaffInvitation } from '@/core/users/api'
import { emailStatusLabel } from '@/core/email/status'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { UsersSettingsPage } from './UsersSettingsPage'

const mocks = vi.hoisted(() => ({
  fetchOrgUsers: vi.fn(),
  fetchPermissionCatalog: vi.fn(),
  fetchOrgRoles: vi.fn(),
  fetchRoleDefaults: vi.fn(),
  fetchUserOverrides: vi.fn(),
  setUserRole: vi.fn(),
  setUserStatus: vi.fn(),
  setPermissionOverride: vi.fn(),
  clearPermissionOverride: vi.fn(),
  listStaffInvitations: vi.fn(),
  inviteStaff: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/core/users/api', () => mocks)
vi.mock('@/core/access/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/access/api')>()),
  fetchOrgRoles: mocks.fetchOrgRoles,
  fetchPermissionCatalog: mocks.fetchPermissionCatalog,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

// The real section: its permissions decide whether the page is read-only (as SettingsLayout does).
const usersSection = coreSettingsSections.find((s) => s.id === 'users') as SettingsSection

const adminCaller = accessForRole('admin', { user_id: 'u-admin', modules: ['professionals'] })
/** users.view without users.manage. */
const viewerCaller = accessForRole('admin_assistant', {
  user_id: 'u-adjointe',
  modules: ['professionals'],
  permissions: ['settings.view', 'professionals.view', 'users.view'],
})

function renderPage({ caller = adminCaller }: { caller?: Access } = {}) {
  const readOnly = isSectionReadOnly(usersSection, (p) => caller.permissions.includes(p))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    renderInSettingsSection(
      <QueryClientProvider client={queryClient}>
        <UsersSettingsPage />
      </QueryClientProvider>,
      { section: usersSection, readOnly, access: { access: caller } },
    ),
  )
}

// `hidden`: while the sheet is open, Radix hides the page from the accessibility tree.
const table = () => screen.getByRole('table', { name: t('settings.users.tableLabel'), hidden: true })
const rowOf = (name: string) => {
  const row = within(table()).getByText(name).closest('tr')
  if (!row) throw new Error(`no row for ${name}`)
  return row
}
const COLUMNS = ['name', 'email', 'role', 'status', 'activity'] as const
/** One cell of a user's row, by column (the phone copies under the name and role live in other cells). */
const cell = (name: string, column: (typeof COLUMNS)[number]) => within(rowOf(name)).getAllByRole('cell', { hidden: true })[COLUMNS.indexOf(column)] as HTMLElement

beforeEach(() => {
  mocks.fetchOrgUsers.mockResolvedValue(testUsers)
  mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
  mocks.fetchOrgRoles.mockResolvedValue(testRoles)
  mocks.fetchRoleDefaults.mockResolvedValue(testRoleDefaults)
  mocks.fetchUserOverrides.mockResolvedValue([])
  mocks.listStaffInvitations.mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('UsersSettingsPage', () => {
  it('lists the users with their role, status and last sign-in (« Jamais » when never)', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t('settings.sections.users') })).toBeInTheDocument()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    // « Inviter » replaces the note about adding people by hand (decision #22), in the section's header (audit §2.4).
    const invite = screen.getByRole('button', { name: t('settings.users.invite.button') })
    expect(invite.compareDocumentPosition(screen.getByRole('tablist')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The admin may change everything here.
    expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
    expect(within(table()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      t('settings.users.columns.name'),
      t('settings.users.columns.email'),
      t('settings.users.columns.role'),
      t('settings.users.columns.status'),
      t('settings.users.columns.activity'),
    ])

    expect(cell('Conseillère Locale', 'email')).toHaveTextContent('conseillere@mana.test')
    expect(cell('Conseillère Locale', 'role')).toHaveTextContent(t('roles.counselor'))
    expect(cell('Conseillère Locale', 'status')).toHaveTextContent(t('settings.users.status.active'))
    // « Activité »: a user's last sign-in, named for screen readers.
    expect(cell('Conseillère Locale', 'activity')).toHaveTextContent(
      `${t('settings.users.lastSignIn')} ${formatClinicDateTime('2026-10-06T13:05:00+00:00')}`,
    )
    // Phones: the email under the name, the status under the role.
    expect(within(cell('Conseillère Locale', 'name')).getByText('conseillere@mana.test')).toBeInTheDocument()
    expect(within(cell('Conseillère Locale', 'role')).getByText(t('settings.users.status.active'))).toBeInTheDocument()

    expect(cell('Adjointe Locale', 'activity')).toHaveTextContent(t('settings.users.never'))
    expect(cell('Adjointe Locale', 'role')).toHaveTextContent(t('roles.admin_assistant'))
    expect(cell('Pro Local', 'status')).toHaveTextContent(t('settings.users.status.disabled'))
    expect(cell('Pro Local', 'role')).toHaveTextContent(t('roles.provider'))
    expect(screen.getByText(t('settings.users.countOther', { count: '4' }))).toBeInTheDocument()
  })

  it('shows « Aucun rôle » for a profile without a role', async () => {
    mocks.fetchOrgUsers.mockResolvedValue([{ ...testUsers[1], user_id: 'u-x', display_name: 'Sans Rôle', role: null, role_name: null }])
    renderPage()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    expect(cell('Sans Rôle', 'role')).toHaveTextContent(t('settings.users.noRole'))
    expect(screen.getByText(t('settings.users.countOne'))).toBeInTheDocument()
  })

  it('opens the sheet from the name button or the row; focus moves to the sheet and back to the name', async () => {
    renderPage()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    await userEvent.click(screen.getByRole('button', { name: 'Conseillère Locale' }))
    const sheet = await screen.findByRole('dialog', { name: 'Conseillère Locale' })
    await waitFor(() => expect(sheet).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conseillère Locale' })).toHaveFocus())

    await userEvent.click(within(rowOf('Pro Local')).getByText(t('roles.provider')))
    expect(await screen.findByRole('dialog', { name: 'Pro Local' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pro Local' })).toHaveFocus())
  })

  it('is read-only without users.manage nor roles.manage: one notice for the page, no buttons, rows do not open', async () => {
    renderPage({ caller: viewerCaller })
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    // The page's notice, above the tabs; none in the tab.
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(within(screen.getByRole('tabpanel')).queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
    expect(within(table()).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settings.users.invite.button') })).not.toBeInTheDocument()
    await userEvent.click(within(rowOf('Conseillère Locale')).getByText(t('roles.counselor')))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the sheet follows the list after a change', async () => {
    mocks.setUserRole.mockResolvedValue(undefined)
    mocks.fetchOrgUsers
      .mockResolvedValueOnce(testUsers)
      .mockResolvedValue(testUsers.map((u) => (u.user_id === 'u-conseillere' ? { ...u, role: 'admin_assistant', role_name: 'Adjointe administrative' } : u)))
    renderPage()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    await userEvent.click(screen.getByRole('button', { name: 'Conseillère Locale' }))
    const role = await screen.findByRole('combobox', { name: t('settings.users.sheet.role.label') })
    await userEvent.selectOptions(role, 'admin_assistant')
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.role.saved')))
    expect(screen.getByRole('combobox', { name: t('settings.users.sheet.role.label') })).toHaveValue('admin_assistant')
    expect(cell('Conseillère Locale', 'role')).toHaveTextContent(t('roles.admin_assistant'))
  })

  it('shows the role matrix in the « Rôles » tab', async () => {
    renderPage()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    expect(screen.getByRole('tab', { name: t('settings.users.tabs.users') })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: t('settings.users.tabs.roles') }))
    expect(await screen.findByRole('table', { name: t('settings.users.matrix.tableLabel') })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(t('settings.users.tabs.roles'))
    expect(screen.queryByRole('table', { name: t('settings.users.tableLabel') })).not.toBeInTheDocument()
  })

  it('with users.view and roles.manage but not users.manage: the users read-only with their notice, the matrix editable', async () => {
    const caller = { ...viewerCaller, permissions: [...viewerCaller.permissions, 'roles.manage'] }
    // Not a read-only section: roles.manage is one of its edit permissions.
    expect(isSectionReadOnly(usersSection, (p) => caller.permissions.includes(p))).toBe(false)
    renderPage({ caller })
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    // The users stay read-only: the notice is in their tab only.
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(within(screen.getByRole('tabpanel')).getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    expect(within(table()).queryByRole('button')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: t('settings.users.tabs.roles') }))
    await screen.findByRole('table', { name: t('settings.users.matrix.tableLabel') })
    expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: t('settings.users.matrix.cellLabel', { role: t('roles.counselor'), permission: 'Voir les paramètres' }) })).not.toHaveAttribute(
      'aria-readonly',
    )
    expect(screen.getByRole('button', { name: t('settings.users.matrix.newRole') })).toBeInTheDocument()
  })

  it('with roles.manage but not users.view: only « Rôles », opened at once, and the users are never asked for', async () => {
    const rolesManager = accessForRole('admin_assistant', {
      user_id: 'u-adjointe',
      modules: ['professionals'],
      permissions: ['settings.view', 'professionals.view', 'roles.manage'],
    })
    renderPage({ caller: rolesManager })
    expect(await screen.findByRole('table', { name: t('settings.users.matrix.tableLabel') })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([t('settings.users.tabs.roles')])
    expect(screen.getByRole('tab', { name: t('settings.users.tabs.roles') })).toHaveAttribute('aria-selected', 'true')
    // list_org_users needs users.view (42501 otherwise).
    expect(mocks.fetchOrgUsers).not.toHaveBeenCalled()
    expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.users.matrix.newRole') })).toBeInTheDocument()
  })

  it('with users.view: « Utilisateurs » first, then « Rôles »', async () => {
    renderPage({ caller: viewerCaller })
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([t('settings.users.tabs.users'), t('settings.users.tabs.roles')])
    expect(screen.getByRole('tab', { name: t('settings.users.tabs.users') })).toHaveAttribute('aria-selected', 'true')
  })

  it('the tabs are reachable by keyboard: one tab stop, the arrow keys switch views (decision #35)', async () => {
    renderPage()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    const usersTab = screen.getByRole('tab', { name: t('settings.users.tabs.users') })
    const rolesTab = screen.getByRole('tab', { name: t('settings.users.tabs.roles') })
    // From the header's « Inviter », Tab reaches the list (Radix: the list is the tab stop and hands focus to the active tab).
    screen.getByRole('button', { name: t('settings.users.invite.button') }).focus()
    await userEvent.tab()
    expect(usersTab).toHaveFocus()
    expect(rolesTab).toHaveAttribute('tabindex', '-1')
    await userEvent.keyboard('{ArrowRight}')
    expect(rolesTab).toHaveFocus()
    expect(rolesTab).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('table', { name: t('settings.users.matrix.tableLabel') })).toBeInTheDocument()
    // Tab then goes into the panel. (happy-dom keeps the old, hidden panel in the DOM, which
    // userEvent.tab() does not skip; the browser check covers the real order.)
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0')
  })

  describe('changing tabs with unsaved edits on the page', () => {
    /** A dirty form elsewhere on the page (the guard is page-wide). */
    function DirtyForm() {
      useUnsavedChanges(true)
      return null
    }
    function renderDirty() {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        renderInSettingsSection(
          <QueryClientProvider client={queryClient}>
            <UnsavedChangesProvider>
              <DirtyForm />
              <UsersSettingsPage />
            </UnsavedChangesProvider>
          </QueryClientProvider>,
          { section: usersSection, readOnly: false, access: { access: adminCaller } },
        ),
      )
    }
    const usersTab = () => screen.getByRole('tab', { name: t('settings.users.tabs.users') })
    const rolesTab = () => screen.getByRole('tab', { name: t('settings.users.tabs.roles') })

    it('asks first, and « Rester » keeps the current tab (focus back on the tab asks nothing)', async () => {
      const user = userEvent.setup()
      renderDirty()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      await user.click(rolesTab())
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: t('common.unsaved.stay') }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(usersTab()).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('table', { name: t('settings.users.tableLabel') })).toBeInTheDocument()
    })

    it('the arrow keys only move focus; Entrée asks, then « Quitter sans enregistrer » switches', async () => {
      const user = userEvent.setup()
      renderDirty()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      screen.getByRole('button', { name: t('settings.users.invite.button') }).focus()
      await user.tab()
      await user.keyboard('{ArrowRight}')
      expect(rolesTab()).toHaveFocus()
      expect(usersTab()).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      await user.keyboard('{Enter}')
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.unsaved.leave') }))
      expect(rolesTab()).toHaveAttribute('aria-selected', 'true')
      expect(await screen.findByRole('table', { name: t('settings.users.matrix.tableLabel') })).toBeInTheDocument()
    })
  })

  it('a click that ends a text selection does not open the sheet', async () => {
    renderPage()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'conseillere@mana.test' } as Selection)
    await userEvent.click(cell('Conseillère Locale', 'email'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    getSelection.mockRestore()
    await userEvent.click(cell('Conseillère Locale', 'email'))
    expect(await screen.findByRole('dialog', { name: 'Conseillère Locale' })).toBeInTheDocument()
  })

  it('shows a load error with a retry instead of an empty list', async () => {
    mocks.fetchOrgUsers.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(testUsers)
    renderPage()
    expect(await screen.findByText(t('settings.users.loadError'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('table', { name: t('settings.users.tableLabel') })).toBeInTheDocument()
  })

  describe('pending invitations (Task 3.22)', () => {
    const pending: StaffInvitation = {
      id: 'i1',
      email: 'nouvelle@mana.test',
      display_name: 'Nouvelle Personne',
      role: 'counselor',
      role_name: 'Conseillère',
      expires_at: '2026-10-15T16:00:00+00:00',
      is_expired: false,
      invited_by_name: 'Admin Local',
      last_email_status: 'delivered',
      last_email_error_code: null,
    }
    const expired: StaffInvitation = {
      ...pending,
      id: 'i2',
      email: 'ancienne@mana.test',
      display_name: 'Ancienne Invitation',
      expires_at: '2026-10-01T16:00:00+00:00',
      is_expired: true,
      last_email_status: 'bounced',
    }
    const names = () => within(table()).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '')

    it('lists them in the same table, after the active users: role, status, last email, expiry and sender', async () => {
      mocks.listStaffInvitations.mockResolvedValue([pending, expired])
      renderPage()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      // Active users, then the invitations, then the disabled accounts (Pro Local).
      expect(names()).toEqual([
        expect.stringContaining('Admin Local'),
        expect.stringContaining('Adjointe Locale'),
        expect.stringContaining('Conseillère Locale'),
        expect.stringContaining('Nouvelle Personne'),
        expect.stringContaining('Ancienne Invitation'),
        expect.stringContaining('Pro Local'),
      ])
      expect(cell('Nouvelle Personne', 'email')).toHaveTextContent('nouvelle@mana.test')
      expect(cell('Nouvelle Personne', 'role')).toHaveTextContent(t('roles.counselor'))
      expect(cell('Nouvelle Personne', 'status')).toHaveTextContent(t('settings.users.invitations.status.sent'))
      expect(cell('Nouvelle Personne', 'status')).toHaveTextContent(
        t('settings.users.invitations.email', { status: emailStatusLabel('delivered', null).label }),
      )
      expect(cell('Nouvelle Personne', 'activity')).toHaveTextContent(
        t('settings.users.invitations.expires', { date: formatClinicDateShort(pending.expires_at ?? '') }),
      )
      expect(cell('Nouvelle Personne', 'activity')).toHaveTextContent(t('settings.users.invitations.invitedBy', { name: 'Admin Local' }))
      expect(screen.getByText(`${t('settings.users.countOther', { count: '4' })} · ${t('settings.users.invitations.countOther', { count: '2' })}`)).toBeInTheDocument()
    })

    it('an expired invitation reads « Expirée »; a bounced email « Adresse introuvable »', async () => {
      mocks.listStaffInvitations.mockResolvedValue([expired])
      renderPage()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      expect(cell('Ancienne Invitation', 'status')).toHaveTextContent(t('settings.users.invitations.status.expired'))
      expect(cell('Ancienne Invitation', 'status')).toHaveTextContent(t('settings.users.invitations.email', { status: t('email.status.bounced') }))
      expect(cell('Ancienne Invitation', 'activity')).toHaveTextContent(
        t('settings.users.invitations.expired', { date: formatClinicDateShort(expired.expires_at ?? '') }),
      )
    })

    it.each([
      ['never left', null, null],
      ['bounced', 'bounced', null],
      ['failed', 'failed', 'provider_rejected'],
      ['failed, code not known yet', 'failed', null],
    ])('an invitation whose email %s reads « Courriel non remis » (warning), not « Invitation envoyée »', async (_label, status, errorCode) => {
      mocks.listStaffInvitations.mockResolvedValue([{ ...pending, last_email_status: status, last_email_error_code: errorCode }])
      renderPage()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      const statusCell = cell('Nouvelle Personne', 'status')
      expect(statusCell).toHaveTextContent(t('settings.users.invitations.status.notDelivered'))
      expect(statusCell).not.toHaveTextContent(t('settings.users.invitations.status.sent'))
      if (status === null) expect(statusCell).toHaveTextContent(t('settings.users.invitations.emailNone'))
    })

    it('an email whose outcome is unknown (provider_unavailable) reads « Résultat inconnu », not a failure', async () => {
      mocks.listStaffInvitations.mockResolvedValue([{ ...pending, last_email_status: 'failed', last_email_error_code: 'provider_unavailable' }])
      renderPage()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      const statusCell = cell('Nouvelle Personne', 'status')
      expect(within(statusCell).getAllByText(t('email.failure.unknownOutcome'), { exact: false })).not.toHaveLength(0)
      expect(statusCell).not.toHaveTextContent(t('settings.users.invitations.status.notDelivered'))
      expect(statusCell).not.toHaveTextContent(t('email.status.failed'))
    })

    it('without users.manage they are listed with no « Renvoyer » nor « Révoquer »', async () => {
      mocks.listStaffInvitations.mockResolvedValue([pending])
      renderPage({ caller: viewerCaller })
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      expect(rowOf('Nouvelle Personne')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: new RegExp(t('settings.users.invitations.resend')) })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: new RegExp(t('settings.users.invitations.revoke')) })).not.toBeInTheDocument()
    })

    it('« Renvoyer » sends a new link through resendInvitation (staff-invite), then refetches the invitations', async () => {
      mocks.listStaffInvitations.mockResolvedValue([pending])
      mocks.resendInvitation.mockResolvedValue({ invitationId: 'i1', expiresAt: null, emailProblem: null })
      renderPage()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      // Each row's actions name the person.
      await userEvent.click(screen.getByRole('button', { name: t('settings.users.invitations.resendLabel', { name: 'Nouvelle Personne' }) }))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.invitations.resent', { email: 'nouvelle@mana.test' })))
      expect(mocks.resendInvitation).toHaveBeenCalledExactlyOnceWith('i1')
      await waitFor(() => expect(mocks.listStaffInvitations).toHaveBeenCalledTimes(2))
    })

    it('« Renvoyer » whose email failed says the old link no longer works', async () => {
      mocks.listStaffInvitations.mockResolvedValue([pending])
      mocks.resendInvitation.mockResolvedValue({ invitationId: 'i1', expiresAt: null, emailProblem: { code: 'provider_error', retryAfter: null } })
      renderPage()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      await userEvent.click(within(rowOf('Nouvelle Personne')).getByRole('button', { name: t('settings.users.invitations.resendLabel', { name: 'Nouvelle Personne' }) }))
      await waitFor(() =>
        expect(mocks.toast.error).toHaveBeenCalledWith(t('settings.users.invitations.resendNotSent'), {
          description: `${t('settings.users.invite.emailProblems.provider_error')} ${t('settings.users.invite.emailAdvice')}`,
        }),
      )
    })

    it('« Révoquer » asks for confirmation first; once confirmed, focus goes to « Inviter » and the row is inactive meanwhile', async () => {
      mocks.listStaffInvitations.mockResolvedValue([pending])
      let finishRevoke: () => void = () => {}
      mocks.revokeInvitation.mockReturnValue(new Promise<void>((resolve) => (finishRevoke = resolve)))
      renderPage()
      await screen.findByRole('table', { name: t('settings.users.tableLabel') })
      const revokeButton = () => screen.getByRole('button', { name: t('settings.users.invitations.revokeLabel', { name: 'Nouvelle Personne' }) })
      const resendButton = () => screen.getByRole('button', { name: t('settings.users.invitations.resendLabel', { name: 'Nouvelle Personne' }) })
      await userEvent.click(revokeButton())
      const confirm = await screen.findByRole('alertdialog', { name: t('settings.users.invitations.revokeConfirm.title', { name: 'Nouvelle Personne' }) })
      expect(confirm).toHaveAccessibleDescription(t('settings.users.invitations.revokeConfirm.body', { email: 'nouvelle@mana.test' }))
      await userEvent.click(within(confirm).getByRole('button', { name: t('common.cancel') }))
      expect(mocks.revokeInvitation).not.toHaveBeenCalled()
      // Cancelled: back to « Révoquer ».
      await waitFor(() => expect(revokeButton()).toHaveFocus())

      await userEvent.click(revokeButton())
      const second = await screen.findByRole('alertdialog')
      await userEvent.click(within(second).getByRole('button', { name: t('settings.users.invitations.revokeConfirm.confirm') }))
      // The dialog keeps its text while it closes.
      expect(second).toHaveTextContent(t('settings.users.invitations.revokeConfirm.title', { name: 'Nouvelle Personne' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      await waitFor(() => expect(screen.getByRole('button', { name: t('settings.users.invite.button') })).toHaveFocus())
      // While the revocation runs, the row's actions are inactive.
      expect(revokeButton()).toHaveAttribute('aria-disabled', 'true')
      expect(resendButton()).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(resendButton())
      expect(mocks.resendInvitation).not.toHaveBeenCalled()

      mocks.listStaffInvitations.mockResolvedValue([])
      finishRevoke()
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.invitations.revoked')))
      expect(mocks.revokeInvitation).toHaveBeenCalledExactlyOnceWith('i1')
      await waitFor(() => expect(within(table()).queryByText('Nouvelle Personne')).not.toBeInTheDocument())
    })

    it('asks for the users and the invitations in parallel; the table waits for both', async () => {
      let resolveUsers: (users: typeof testUsers) => void = () => {}
      mocks.fetchOrgUsers.mockReturnValue(new Promise((resolve) => (resolveUsers = resolve)))
      let resolveInvitations: (rows: StaffInvitation[]) => void = () => {}
      mocks.listStaffInvitations.mockReturnValue(new Promise((resolve) => (resolveInvitations = resolve)))
      renderPage()
      await waitFor(() => expect(mocks.fetchOrgUsers).toHaveBeenCalledTimes(1))
      expect(mocks.listStaffInvitations).toHaveBeenCalledTimes(1)
      resolveUsers(testUsers)
      await screen.findByText(t('common.loading'))
      expect(screen.queryByRole('table', { name: t('settings.users.tableLabel') })).not.toBeInTheDocument()
      resolveInvitations([pending])
      expect(await screen.findByRole('table', { name: t('settings.users.tableLabel') })).toBeInTheDocument()
    })

    it('only the invitations failed: the users still show, with the invitations\' own error; « Réessayer » asks for them again', async () => {
      mocks.listStaffInvitations.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([pending])
      renderPage()
      expect(await screen.findByText(t('settings.users.invitations.loadError'))).toBeInTheDocument()
      expect(screen.queryByText(t('settings.users.loadError'))).not.toBeInTheDocument()
      expect(screen.getByRole('table', { name: t('settings.users.tableLabel') })).toBeInTheDocument()
      expect(rowOf('Conseillère Locale')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
      expect(await within(table()).findByText('Nouvelle Personne')).toBeInTheDocument()
      expect(screen.queryByText(t('settings.users.invitations.loadError'))).not.toBeInTheDocument()
      expect(mocks.fetchOrgUsers).toHaveBeenCalledTimes(1)
    })

    it('both failed: the users\' load error, and « Réessayer » asks for both again', async () => {
      mocks.fetchOrgUsers.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(testUsers)
      mocks.listStaffInvitations.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([pending])
      renderPage()
      expect(await screen.findByText(t('settings.users.loadError'))).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
      expect(await within(await screen.findByRole('table', { name: t('settings.users.tableLabel') })).findByText('Nouvelle Personne')).toBeInTheDocument()
    })
  })
})
