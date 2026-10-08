import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { testCatalog, testUsers } from '@/test/users-fixtures'
import type { OrgUser } from '../api'
import { UserSheet } from './UserSheet'

const mocks = vi.hoisted(() => ({
  fetchPermissionCatalog: vi.fn(),
  fetchUserOverrides: vi.fn(),
  setUserRole: vi.fn(),
  setUserStatus: vi.fn(),
  setPermissionOverride: vi.fn(),
  clearPermissionOverride: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api', () => ({
  fetchOrgUsers: vi.fn(),
  fetchPermissionCatalog: mocks.fetchPermissionCatalog,
  fetchUserOverrides: mocks.fetchUserOverrides,
  setUserRole: mocks.setUserRole,
  setUserStatus: mocks.setUserStatus,
  setPermissionOverride: mocks.setPermissionOverride,
  clearPermissionOverride: mocks.clearPermissionOverride,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const [admin, adjointe, conseillere, pro] = testUsers as [OrgUser, OrgUser, OrgUser, OrgUser]
const adminCaller = accessForRole('admin', { user_id: admin.user_id, modules: ['professionals'] })
/** A non-admin manager: the adjointe given users.view + users.manage. */
const managerCaller = accessForRole('admin_assistant', {
  user_id: adjointe.user_id,
  modules: ['professionals'],
  permissions: ['settings.view', 'professionals.view', 'users.view', 'users.manage'],
})

function renderSheet(user: OrgUser, caller: Access = adminCaller) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onClose = vi.fn()
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <UserSheet user={user} onClose={onClose} />
      </QueryClientProvider>,
      { access: { access: caller } },
    ),
  )
  return { onClose }
}

/** The radio group of one permission, by its description. */
const permission = (description: string) => screen.getByRole('group', { name: description })

beforeEach(() => {
  mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
  mocks.fetchUserOverrides.mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('UserSheet', () => {
  it('shows the name, email, status and last sign-in (« Jamais » when never)', async () => {
    renderSheet(adjointe)
    const dialog = await screen.findByRole('dialog', { name: 'Adjointe Locale' })
    expect(dialog).toHaveAccessibleDescription('adjointe@mana.test')
    expect(within(dialog).getByText(t('settings.users.status.active'))).toBeInTheDocument()
    // getByText normalizes the DOM text (U+00A0 becomes a space) but not the expected string.
    const lastSignIn = t('settings.users.sheet.lastSignIn', { date: t('settings.users.never') })
    expect(within(dialog).getByText(lastSignIn.replace(/\s+/g, ' '))).toBeInTheDocument()
    expect(lastSignIn).toBe('Dernière connexion\u00a0: Jamais')
  })

  it('changing the role calls setUserRole and toasts', async () => {
    mocks.setUserRole.mockResolvedValue(undefined)
    renderSheet(conseillere)
    const role = await screen.findByRole('combobox', { name: t('settings.users.sheet.role.label') })
    expect(role).toHaveValue('counselor')
    await userEvent.selectOptions(role, 'admin_assistant')
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.role.saved')))
    expect(mocks.setUserRole).toHaveBeenCalledWith('u-conseillere', 'admin_assistant')
  })

  it('shows the database message when the role change is refused', async () => {
    mocks.setUserRole.mockRejectedValue({ code: 'P0001', message: 'La clinique doit garder au moins un administrateur actif.' })
    renderSheet(conseillere)
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: t('settings.users.sheet.role.label') }), 'admin')
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('La clinique doit garder au moins un administrateur actif.'))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('disabling asks for confirmation first', async () => {
    mocks.setUserStatus.mockResolvedValue(undefined)
    renderSheet(conseillere)
    const active = await screen.findByRole('switch', { name: t('settings.users.sheet.status.label') })
    expect(active).toBeChecked()

    await userEvent.click(active)
    const confirm = await screen.findByRole('alertdialog', { name: t('settings.users.sheet.status.confirmTitle') })
    expect(confirm).toHaveAccessibleDescription(t('settings.users.sheet.status.confirmBody', { name: 'Conseillère Locale' }))
    expect(mocks.setUserStatus).not.toHaveBeenCalled()

    await userEvent.click(within(confirm).getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.setUserStatus).not.toHaveBeenCalled()
    // Opened without a trigger: focus still returns to the switch.
    await waitFor(() => expect(screen.getByRole('switch', { name: t('settings.users.sheet.status.label') })).toHaveFocus())

    await userEvent.click(screen.getByRole('switch', { name: t('settings.users.sheet.status.label') }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.users.sheet.status.confirm') }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.status.disabledSaved')))
    expect(mocks.setUserStatus).toHaveBeenCalledWith('u-conseillere', 'disabled')
    expect(screen.getByRole('switch', { name: t('settings.users.sheet.status.label') })).toHaveFocus()
  })

  it('an admin re-enables a disabled account at once', async () => {
    mocks.setUserStatus.mockResolvedValue(undefined)
    renderSheet(pro)
    const active = await screen.findByRole('switch', { name: t('settings.users.sheet.status.label') })
    expect(active).not.toBeChecked()
    await userEvent.click(active)
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.status.enabledSaved')))
    expect(mocks.setUserStatus).toHaveBeenCalledWith('u-pro', 'active')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('the last-admin guard shows its message in a toast', async () => {
    mocks.setUserStatus.mockRejectedValue({ code: 'P0001', message: 'La clinique doit garder au moins un administrateur actif.' })
    renderSheet(conseillere)
    await userEvent.click(await screen.findByRole('switch', { name: t('settings.users.sheet.status.label') }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.users.sheet.status.confirm') }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('La clinique doit garder au moins un administrateur actif.'))
  })

  describe('permissions', () => {
    it('one group per module (core first, enabled modules only), the role default in the first option', async () => {
      renderSheet(conseillere)
      expect(await screen.findByRole('heading', { name: t('settings.users.sheet.permissions.coreGroup') })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Professionnels' })).toBeInTheDocument()
      expect(screen.queryByText('Voir la facturation')).not.toBeInTheDocument()
      // counselor: professionals.view by default, audit.view not.
      expect(within(permission('Voir les professionnels')).getByRole('radio', { name: 'Selon le rôle (Oui)' })).toBeChecked()
      expect(within(permission("Consulter le journal d'audit")).getByRole('radio', { name: 'Selon le rôle (Non)' })).toBeChecked()
    })

    it('reflects the overrides', async () => {
      mocks.fetchUserOverrides.mockResolvedValue([
        { permission_key: 'audit.view', granted: true },
        { permission_key: 'professionals.view', granted: false },
      ])
      renderSheet(conseillere)
      expect(await screen.findByRole('radio', { name: t('settings.users.sheet.permissions.granted'), checked: true })).toBeInTheDocument()
      expect(within(permission("Consulter le journal d'audit")).getByRole('radio', { name: t('settings.users.sheet.permissions.granted') })).toBeChecked()
      expect(within(permission('Voir les professionnels')).getByRole('radio', { name: t('settings.users.sheet.permissions.revoked') })).toBeChecked()
      expect(mocks.fetchUserOverrides).toHaveBeenCalledWith('u-conseillere')
    })

    it('the three-state control grants, revokes and clears', async () => {
      mocks.setPermissionOverride.mockResolvedValue(undefined)
      mocks.clearPermissionOverride.mockResolvedValue(undefined)
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'professionals.view', granted: false }])
      renderSheet(conseillere)
      await screen.findByRole('group', { name: "Consulter le journal d'audit" })

      await userEvent.click(within(permission("Consulter le journal d'audit")).getByRole('radio', { name: t('settings.users.sheet.permissions.granted') }))
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'audit.view', true))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.permissions.saved')))

      await userEvent.click(within(permission('Voir les paramètres')).getByRole('radio', { name: t('settings.users.sheet.permissions.revoked') }))
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'settings.view', false))

      await userEvent.click(within(permission('Voir les professionnels')).getByRole('radio', { name: 'Selon le rôle (Oui)' }))
      await waitFor(() => expect(mocks.clearPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'professionals.view'))
      expect(mocks.toast.error).not.toHaveBeenCalled()
    })

    it('shows the requested state while saving and ignores other choices meanwhile', async () => {
      mocks.setPermissionOverride.mockReturnValue(new Promise(() => {}))
      renderSheet(conseillere)
      await screen.findByRole('group', { name: "Consulter le journal d'audit" })
      const group = permission("Consulter le journal d'audit")
      await userEvent.click(within(group).getByRole('radio', { name: t('settings.users.sheet.permissions.granted') }))
      const granted = within(group).getByRole('radio', { name: t('settings.users.sheet.permissions.granted') })
      await waitFor(() => expect(granted).toHaveAttribute('aria-disabled', 'true'))
      expect(granted).toBeChecked()
      expect(group).toHaveAttribute('aria-busy', 'true')
      await userEvent.click(within(group).getByRole('radio', { name: t('settings.users.sheet.permissions.revoked') }))
      expect(mocks.setPermissionOverride).toHaveBeenCalledTimes(1)
      expect(granted).toBeChecked()
    })

    it('shows the database message when a change is refused', async () => {
      mocks.setPermissionOverride.mockRejectedValue({ code: 'P0001', message: "Vous ne pouvez pas accorder une permission que vous n'avez pas." })
      renderSheet(conseillere)
      await screen.findByRole('group', { name: "Consulter le journal d'audit" })
      await userEvent.click(within(permission("Consulter le journal d'audit")).getByRole('radio', { name: t('settings.users.sheet.permissions.granted') }))
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Vous ne pouvez pas accorder une permission que vous n'avez pas."))
      expect(within(permission("Consulter le journal d'audit")).getByRole('radio', { name: 'Selon le rôle (Non)' })).toBeChecked()
    })

    it('an admin has no permission controls, only the note', async () => {
      renderSheet({ ...conseillere, user_id: 'u-other-admin', role: 'admin', role_name: 'Administrateur' })
      expect(await screen.findByText(t('settings.users.sheet.permissions.admin'))).toBeInTheDocument()
      expect(screen.queryByRole('radio')).not.toBeInTheDocument()
      expect(mocks.fetchUserOverrides).not.toHaveBeenCalled()
    })
  })

  it("the caller's own account: read-only, with a link to « Mon compte »", async () => {
    renderSheet(admin)
    const link = await screen.findByRole('link', { name: t('settings.users.sheet.selfLink') })
    expect(link).toHaveAttribute('href', '/mon-compte')
    expect(screen.getByRole('textbox', { name: t('settings.users.sheet.role.label') })).toHaveAttribute('readonly')
    const active = screen.getByRole('switch', { name: t('settings.users.sheet.status.label') })
    expect(active).toHaveAttribute('aria-readonly', 'true')
    await userEvent.click(active)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.setUserStatus).not.toHaveBeenCalled()
  })

  it("a provider's role is read-only, managed in Professionnels", async () => {
    renderSheet(pro)
    const role = await screen.findByRole('textbox', { name: t('settings.users.sheet.role.label') })
    expect(role).toHaveValue('Professionnel')
    expect(role).toHaveAccessibleDescription(t('settings.users.sheet.role.provider'))
  })

  describe('as a non-admin manager', () => {
    it('cannot change an admin', async () => {
      renderSheet({ ...conseillere, user_id: 'u-other-admin', role: 'admin', role_name: 'Administrateur' }, managerCaller)
      expect(await screen.findByText(t('settings.users.sheet.adminOnly'))).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: t('settings.users.sheet.role.label') })).toHaveAttribute('readonly')
      expect(screen.getByRole('switch', { name: t('settings.users.sheet.status.label') })).toHaveAttribute('aria-readonly', 'true')
    })

    it('may assign only the roles whose defaults they hold, never admin', async () => {
      renderSheet(conseillere, managerCaller)
      const role = await screen.findByRole('combobox', { name: t('settings.users.sheet.role.label') })
      await waitFor(() => expect(within(role).getByRole('option', { name: 'Adjointe administrative' })).toBeEnabled())
      expect(within(role).getByRole('option', { name: 'Administrateur' })).toBeDisabled()
      expect(within(role).getByRole('option', { name: 'Conseillère' })).toBeEnabled()
      expect(role).toHaveAccessibleDescription(t('settings.users.sheet.role.managerLimit'))
    })

    it('may not grant, nor clear a revoke of, a permission they lack', async () => {
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: false }])
      renderSheet(conseillere, managerCaller)
      await screen.findByRole('group', { name: "Consulter le journal d'audit" })
      const audit = permission("Consulter le journal d'audit")
      expect(within(audit).getByRole('radio', { name: t('settings.users.sheet.permissions.granted') })).toBeDisabled()
      expect(within(audit).getByRole('radio', { name: 'Selon le rôle (Non)' })).toBeDisabled()
      expect(within(audit).getByRole('radio', { name: t('settings.users.sheet.permissions.revoked') })).toBeChecked()
      // A permission the manager holds stays fully open.
      const settings = permission('Voir les paramètres')
      expect(within(settings).getByRole('radio', { name: t('settings.users.sheet.permissions.granted') })).toBeEnabled()
    })

    it('may disable but not re-enable an account', async () => {
      renderSheet(pro, managerCaller)
      const active = await screen.findByRole('switch', { name: t('settings.users.sheet.status.label') })
      expect(active).toHaveAttribute('aria-readonly', 'true')
      expect(active).toHaveAccessibleDescription(t('settings.users.sheet.status.reenableAdminOnly'))
      await userEvent.click(active)
      expect(mocks.setUserStatus).not.toHaveBeenCalled()
    })
  })
})
