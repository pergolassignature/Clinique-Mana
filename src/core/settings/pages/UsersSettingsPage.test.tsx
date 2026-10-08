import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import type { SettingsSection } from '@/core/modules/types'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { testCatalog, testRoleDefaults, testRoles, testUsers } from '@/test/users-fixtures'
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
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/core/users/api', () => mocks)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const usersSection: SettingsSection = {
  id: 'users',
  path: 'utilisateurs',
  labelKey: 'settings.sections.users',
  icon: Users,
  permission: 'users.view',
  editPermission: 'users.manage',
  group: 'plateforme',
  component: (() => null) as unknown as SettingsSection['component'],
}

const adminCaller = accessForRole('admin', { user_id: 'u-admin', modules: ['professionals'] })
/** users.view without users.manage. */
const viewerCaller = accessForRole('admin_assistant', {
  user_id: 'u-adjointe',
  modules: ['professionals'],
  permissions: ['settings.view', 'professionals.view', 'users.view'],
})

function renderPage({ caller = adminCaller, readOnly = false }: { caller?: Access; readOnly?: boolean } = {}) {
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
const COLUMNS = ['name', 'email', 'role', 'status', 'lastSignIn'] as const
/** One cell of a user's row, by column (the phone copies under the name and role live in other cells). */
const cell = (name: string, column: (typeof COLUMNS)[number]) => within(rowOf(name)).getAllByRole('cell', { hidden: true })[COLUMNS.indexOf(column)] as HTMLElement

beforeEach(() => {
  mocks.fetchOrgUsers.mockResolvedValue(testUsers)
  mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
  mocks.fetchOrgRoles.mockResolvedValue(testRoles)
  mocks.fetchRoleDefaults.mockResolvedValue(testRoleDefaults)
  mocks.fetchUserOverrides.mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('UsersSettingsPage', () => {
  it('lists the users with their role, status and last sign-in (« Jamais » when never)', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: t('settings.sections.users') })).toBeInTheDocument()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    expect(screen.getByText(t('settings.users.addNote'))).toBeInTheDocument()
    expect(within(table()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      t('settings.users.columns.name'),
      t('settings.users.columns.email'),
      t('settings.users.columns.role'),
      t('settings.users.columns.status'),
      t('settings.users.columns.lastSignIn'),
    ])

    expect(cell('Conseillère Locale', 'email')).toHaveTextContent('conseillere@mana.test')
    expect(cell('Conseillère Locale', 'role')).toHaveTextContent(t('roles.counselor'))
    expect(cell('Conseillère Locale', 'status')).toHaveTextContent(t('settings.users.status.active'))
    expect(cell('Conseillère Locale', 'lastSignIn')).toHaveTextContent(formatClinicDateTime('2026-10-06T13:05:00+00:00'))
    // Phones: the email under the name, the status under the role.
    expect(within(cell('Conseillère Locale', 'name')).getByText('conseillere@mana.test')).toBeInTheDocument()
    expect(within(cell('Conseillère Locale', 'role')).getByText(t('settings.users.status.active'))).toBeInTheDocument()

    expect(cell('Adjointe Locale', 'lastSignIn')).toHaveTextContent(t('settings.users.never'))
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

  it('is read-only without users.manage: the notice, no buttons, rows do not open', async () => {
    renderPage({ caller: viewerCaller, readOnly: true })
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    expect(within(table()).queryByRole('button')).not.toBeInTheDocument()
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

  it('the « Rôles » tab follows roles.manage, not users.manage', async () => {
    renderPage({ caller: { ...viewerCaller, permissions: [...viewerCaller.permissions, 'roles.manage'] }, readOnly: true })
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    // The users stay read-only: the notice is in their tab only.
    expect(within(screen.getByRole('tabpanel')).getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: t('settings.users.tabs.roles') }))
    await screen.findByRole('table', { name: t('settings.users.matrix.tableLabel') })
    expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: t('settings.users.matrix.cellLabel', { role: t('roles.counselor'), permission: 'Voir les paramètres' }) })).not.toHaveAttribute(
      'aria-readonly',
    )
    expect(screen.getByRole('button', { name: t('settings.users.matrix.newRole') })).toBeInTheDocument()
  })

  it('the tabs are reachable by keyboard: one tab stop, the arrow keys switch views (decision #35)', async () => {
    renderPage()
    await screen.findByRole('table', { name: t('settings.users.tableLabel') })
    const usersTab = screen.getByRole('tab', { name: t('settings.users.tabs.users') })
    const rolesTab = screen.getByRole('tab', { name: t('settings.users.tabs.roles') })
    // Tab reaches the list (Radix: the list is the tab stop and hands focus to the active tab).
    screen.getByRole('heading', { level: 2, name: t('settings.sections.users') }).focus()
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
})
